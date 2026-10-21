// Pagamentos e prêmio na Solana (USDC). Só é carregado quando PAYMENT_MODE=solana.
//
//  - Entrada: o servidor monta uma transação (USDC do jogador -> carteira da casa) com a taxa de rede paga pela casa; o jogador só assina.
//  - Reembolso: a casa devolve o USDC ao mesmo endereço.
//  - Prêmio: a casa compra o pacote na API do Collector Crypt e a carta vai direto para a carteira do vencedor (altPlayerAddress).
//
// SEGURANÇA / CUSTO: por padrão SÓ DEVNET (moeda de teste, zero custo). Mainnet exige ALLOW_MAINNET=yes (dinheiro real) e hosts de produção.
import fs from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction, clusterApiUrl } from '@solana/web3.js';
import { createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';

const env = k => String(process.env[k] || '').trim().replace(/^["']+|["']+$/g, '').trim();   // tolera espaços e aspas coladas por engano nas variáveis
const NETWORK = (env('SOLANA_NETWORK') || 'devnet').toLowerCase();
const REAL = NETWORK !== 'devnet';
if (REAL && env('ALLOW_MAINNET') !== 'yes') throw new Error(`SOLANA_NETWORK=${JSON.stringify(NETWORK)} não é "devnet" e a mainnet (dinheiro real) está bloqueada. Corrija o valor para exatamente: devnet  (ou apague a variável SOLANA_NETWORK).`);
const RPC = env('SOLANA_RPC_URL') || (REAL ? 'https://api.mainnet-beta.solana.com' : clusterApiUrl('devnet'));   // RPC principal; na mainnet, um segundo (reserva) é consultado junto
const RPC_LIST = [...new Set([RPC, ...(REAL ? ['https://solana-rpc.publicnode.com'] : [])])];   // provedores gratuitos podem ficar atrasados: usamos mais de um
const GACHA = env('GACHA_URL') || (REAL ? 'https://gacha.collectorcrypt.com' : 'https://dev-gacha.collectorcrypt.com');
if (REAL === GACHA.includes('dev-gacha')) throw new Error('Rede e host do Collector Crypt não combinam (devnet <-> dev-gacha)');
const MINT = new PublicKey(REAL ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');   // USDC (devnet: o mesmo que a máquina de teste cobra)
const DECIMALS = 6, MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const MAX_PACK_USD = +env('MAX_PACK_USD') || (REAL ? 25 : 100);              // teto de gasto por prêmio
const MAX_DAILY_USD = +env('MAX_DAILY_PACK_USD') || 1e9;                      // teto diário opcional (sem limite por padrão)
const MIN_SOL = +env('MIN_HOUSE_SOL') || (REAL ? 0.005 : 0.0005);            // SOL mínimo na casa para pagar taxas de rede
let spentDay = 0, dayKey = '';
const dayCheck = usd => { const k = new Date().toISOString().slice(0, 10); if (k !== dayKey) { dayKey = k; spentDay = 0; } if (spentDay + usd > MAX_DAILY_USD) throw new Error(`Limite diário de compra de pacotes atingido (${spentDay}+${usd} > ${MAX_DAILY_USD})`); };
const API_KEY = env('GACHA_API_KEY');

function loadKey() {
  let raw = env('HOUSE_SECRET_KEY');
  if (!raw && env('HOUSE_KEY_FILE')) raw = fs.readFileSync(env('HOUSE_KEY_FILE'), 'utf8');
  if (!raw) throw new Error('Defina HOUSE_SECRET_KEY (JSON com 64 números) ou HOUSE_KEY_FILE');
  let j = JSON.parse(raw); if (!Array.isArray(j)) j = j.house;
  return Keypair.fromSecretKey(Uint8Array.from(j));
}
const house = loadKey();
const CONNS = RPC_LIST.map(u => new Connection(u, 'confirmed')), conn = CONNS[0];
const firstOk = async fn => { let last; for (const c of CONNS) { try { return await fn(c); } catch (e) { last = e; } } throw last; };   // tenta cada provedor até um responder
const houseAta = getAssociatedTokenAddressSync(MINT, house.publicKey);
const units = usd => BigInt(Math.round(usd * 10 ** DECIMALS));
const memoIx = text => new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(text, 'utf8') });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function statusOf(sig) {   // consulta todos os provedores; qualquer um que viu a transação vale
  const rs = await Promise.all(CONNS.map(c => c.getSignatureStatuses([sig], { searchTransactionHistory: true }).then(r => r.value[0]).catch(() => null)));
  const bad = rs.find(x => x && x.err); if (bad) return { err: bad.err };
  return rs.find(x => x && (x.confirmationStatus === 'confirmed' || x.confirmationStatus === 'finalized')) ? { ok: true } : null;
}
const heightNow = async () => Math.max(...await Promise.all(CONNS.map(c => c.getBlockHeight('confirmed').catch(() => 0))));
async function confirmPoll(sig, lastValidBlockHeight) {   // só desiste depois que o blockhash EXPIROU (aí a transação não pode mais entrar) e uma última checagem
  let expired = false;
  for (let i = 0; i < 200; i++) {
    const st = await statusOf(sig);
    if (st && st.err) throw new Error('Transação falhou: ' + JSON.stringify(st.err));
    if (st && st.ok) return;
    if (expired) throw new Error('blockhash expired');
    if (i % 3 === 2 && (await heightNow()) > lastValidBlockHeight + 2) expired = true;
    await sleep(1000);
  }
  throw new Error('timeout confirmando a transação');
}

export const info = () => ({ network: NETWORK, real: REAL, rpc: RPC_LIST.join(' + '), gacha: GACHA, house: house.publicKey.toBase58(), mint: MINT.toBase58(), maxPackUsd: MAX_PACK_USD, maxDailyUsd: MAX_DAILY_USD, minSol: MIN_SOL });
export async function houseBalances() {
  const sol = await firstOk(c => c.getBalance(house.publicKey));
  const reads = await Promise.all(CONNS.map(c => c.getTokenAccountBalance(houseAta).then(r => Number(r.value.uiAmount || 0)).catch(() => null)));
  const ok = reads.filter(x => x !== null);
  return { sol: sol / 1e9, usdc: ok.length ? Math.max(...ok) : 0 };
}
export async function init() { const b = await houseBalances(); return { ...info(), ...b }; }

// ---- entrada: transação para o jogador assinar (taxa paga pela casa; a casa já assina a parte dela)
export async function buildPayTx(payerStr, usd, memo) {
  const payer = new PublicKey(payerStr), payerAta = getAssociatedTokenAddressSync(MINT, payer);
  const { blockhash, lastValidBlockHeight } = await firstOk(c => c.getLatestBlockhash('confirmed'));
  const tx = new Transaction({ feePayer: house.publicKey, blockhash, lastValidBlockHeight })
    .add(createAssociatedTokenAccountIdempotentInstruction(house.publicKey, houseAta, house.publicKey, MINT))   // cria a conta de USDC da casa se ainda não existir (a casa paga ~0,002 SOL uma única vez)
    .add(createTransferCheckedInstruction(payerAta, MINT, houseAta, payer, units(usd), DECIMALS)).add(memoIx(memo));
  tx.partialSign(house);
  return { tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), message: tx.serializeMessage().toString('base64'), blockhash, lastValidBlockHeight };
}
// confere que o que voltou é EXATAMENTE a transação que montamos, assinada pelo jogador, e envia
export async function submitPayTx(signedB64, expected) {
  const tx = Transaction.from(Buffer.from(signedB64, 'base64'));
  if (tx.serializeMessage().toString('base64') !== expected.message) throw new Error('A transação foi alterada');
  const payer = new PublicKey(expected.payer);
  const ps = tx.signatures.find(s => s.publicKey.equals(payer));
  if (!ps || !ps.signature || !tx.verifySignatures()) throw new Error('Assinatura do jogador ausente ou inválida');
  const raw = tx.serialize();
  const sig = await firstOk(c => c.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }));
  CONNS.slice(1).forEach(c => c.sendRawTransaction(raw, { skipPreflight: true }).catch(() => {}));   // reforço: manda também aos outros provedores (mesma assinatura, não duplica)
  await confirmPoll(sig, expected.lastValidBlockHeight);
  return sig;
}

// ---- reembolso: casa -> jogador
export async function refund(toStr, usd, memo) {
  const to = new PublicKey(toStr), toAta = getAssociatedTokenAddressSync(MINT, to);
  const { blockhash, lastValidBlockHeight } = await firstOk(c => c.getLatestBlockhash('confirmed'));
  const tx = new Transaction({ feePayer: house.publicKey, blockhash, lastValidBlockHeight })
    .add(createAssociatedTokenAccountIdempotentInstruction(house.publicKey, toAta, to, MINT))
    .add(createTransferCheckedInstruction(houseAta, MINT, toAta, house.publicKey, units(usd), DECIMALS)).add(memoIx(memo));
  tx.sign(house);
  const raw = tx.serialize();
  const sig = await firstOk(c => c.sendRawTransaction(raw, { preflightCommitment: 'confirmed' }));
  CONNS.slice(1).forEach(c => c.sendRawTransaction(raw, { skipPreflight: true }).catch(() => {}));
  await confirmPoll(sig, lastValidBlockHeight);
  return sig;
}

// ---- prêmio: compra o pacote e entrega ao vencedor
const gacha = async (path, body) => {
  const r = await fetch(GACHA + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(API_KEY ? { 'x-api-key': API_KEY } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  let j = null; try { j = await r.json(); } catch { /* corpo vazio */ }
  return { status: r.status, body: j };
};
const ownerOfCoreAsset = async addr => { const a = await firstOk(c => c.getAccountInfo(new PublicKey(addr))); return a ? new PublicKey(a.data.subarray(1, 33)).toBase58() : null; };   // Metaplex Core: [key:1][owner:32]
export class PrizeError extends Error { constructor(m, paid = false, memo = null) { super(m); this.paid = paid; this.memo = memo; } }   // paid=true: o pacote já foi pago (não dá para devolver sem abrir)
const mapOpen = (o, memo, winnerStr) => ({ memo, nft: o.nft_address, name: o.nftWon?.content?.metadata?.name || 'Card', rarity: o.rarity, insured: o.insuredValue, image: o.nftWon?.content?.files?.[0]?.cdn_uri || o.nftWon?.content?.files?.[0]?.uri || null });
export async function buyPack(packCode, usdPrice, winnerStr) {
  if (usdPrice > MAX_PACK_USD) throw new PrizeError(`Pacote de US$${usdPrice} acima do teto MAX_PACK_USD=${MAX_PACK_USD}`);
  try { dayCheck(usdPrice); new PublicKey(winnerStr); } catch (e) { throw new PrizeError(e.message); }
  // 1) antes de pagar: a máquina existe, tem estoque e o preço é o esperado?
  let mach = null; try { const r = await fetch(GACHA + '/api/machines', { signal: AbortSignal.timeout(15000) }); mach = (await r.json())?.machines?.find(m => m.code === packCode); } catch { /* tratado abaixo */ }
  if (!mach) throw new PrizeError('Máquina ' + packCode + ' indisponível');
  if (Number(mach.price) !== usdPrice) throw new PrizeError(`Preço mudou: ${mach.price} (esperado ${usdPrice})`);
  if (mach.stock && Object.values(mach.stock).reduce((a, b) => a + (+b || 0), 0) <= 0) throw new PrizeError('Sem estoque em ' + packCode);
  const bal = await houseBalances().catch(() => null); if (!bal || bal.usdc < usdPrice) throw new PrizeError(`Saldo USDC da casa insuficiente (${bal && bal.usdc} < ${usdPrice})`);
  // 2) pede o pacote e paga
  const gen = await gacha('/api/generatePack', { playerAddress: house.publicKey.toBase58(), packType: packCode, altPlayerAddress: winnerStr }).catch(e => { throw new PrizeError('generatePack: ' + e.message); });
  if (gen.status !== 200 || !gen.body?.transaction) throw new PrizeError('generatePack falhou: ' + gen.status + ' ' + JSON.stringify(gen.body).slice(0, 200));
  const memo = gen.body.memo, tx = VersionedTransaction.deserialize(Buffer.from(gen.body.transaction, 'base64')); tx.sign([house]);
  let sub; try { sub = await gacha('/api/submitTransaction', { signedTransaction: Buffer.from(tx.serialize()).toString('base64') }); } catch (e) { throw new PrizeError('submitTransaction sem resposta: ' + e.message, true, memo); }   // pode ter pago: não devolver
  if (sub.status !== 200 || !sub.body?.success) throw new PrizeError('submitTransaction falhou: ' + sub.status + ' ' + JSON.stringify(sub.body).slice(0, 200), sub.status >= 500, memo);
  // 3) abre (depois de pago, só resta abrir)
  const o = await openPack(memo, 25, 3000); if (!o) throw new PrizeError('openPack não confirmou a tempo', true, memo);
  await sleep(1500);
  let owner = null; try { owner = await ownerOfCoreAsset(o.nft_address); } catch { /* só para log */ }
  spentDay += usdPrice;
  return { ...mapOpen(o, memo, winnerStr), owner, delivered: owner === winnerStr };
}
async function openPack(memo, tries, everyMs) {
  for (let i = 0; i < tries; i++) {
    const r = await gacha('/api/openPack', { memo }).catch(() => null);
    if (r && r.body?.success && r.body.nft_address) return r.body;
    await sleep(everyMs);
  }
  return null;
}
// pacote já pago mas ainda não aberto: tenta por até ~100 min (o prazo da API é 2 h)
export async function openLater(memo, winnerStr) {
  const o = await openPack(memo, 100, 60000); if (!o) return null;
  await sleep(1500); let owner = null; try { owner = await ownerOfCoreAsset(o.nft_address); } catch { /* log */ }
  return { ...mapOpen(o, memo, winnerStr), owner, delivered: owner === winnerStr };
}
