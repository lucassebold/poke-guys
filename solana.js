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
const RPC = env('SOLANA_RPC_URL') || clusterApiUrl(REAL ? 'mainnet-beta' : 'devnet');
const GACHA = env('GACHA_URL') || (REAL ? 'https://gacha.collectorcrypt.com' : 'https://dev-gacha.collectorcrypt.com');
if (REAL === GACHA.includes('dev-gacha')) throw new Error('Rede e host do Collector Crypt não combinam (devnet <-> dev-gacha)');
const MINT = new PublicKey(REAL ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');   // USDC (devnet: o mesmo que a máquina de teste cobra)
const DECIMALS = 6, MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const MAX_PACK_USD = +process.env.MAX_PACK_USD || 100;   // teto de gasto por prêmio
const API_KEY = env('GACHA_API_KEY');

function loadKey() {
  let raw = env('HOUSE_SECRET_KEY');
  if (!raw && env('HOUSE_KEY_FILE')) raw = fs.readFileSync(env('HOUSE_KEY_FILE'), 'utf8');
  if (!raw) throw new Error('Defina HOUSE_SECRET_KEY (JSON com 64 números) ou HOUSE_KEY_FILE');
  let j = JSON.parse(raw); if (!Array.isArray(j)) j = j.house;
  return Keypair.fromSecretKey(Uint8Array.from(j));
}
const house = loadKey();
const conn = new Connection(RPC, 'confirmed');
const houseAta = getAssociatedTokenAddressSync(MINT, house.publicKey);
const units = usd => BigInt(Math.round(usd * 10 ** DECIMALS));
const memoIx = text => new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(text, 'utf8') });
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const info = () => ({ network: NETWORK, rpc: RPC, gacha: GACHA, house: house.publicKey.toBase58(), mint: MINT.toBase58(), maxPackUsd: MAX_PACK_USD });
export async function houseBalances() {
  const sol = await conn.getBalance(house.publicKey);
  let usdc = 0; try { usdc = Number((await conn.getTokenAccountBalance(houseAta)).value.uiAmount || 0); } catch { /* conta ainda não existe */ }
  return { sol: sol / 1e9, usdc };
}
export async function init() { const b = await houseBalances(); return { ...info(), ...b }; }

// ---- entrada: transação para o jogador assinar (taxa paga pela casa; a casa já assina a parte dela)
export async function buildPayTx(payerStr, usd, memo) {
  const payer = new PublicKey(payerStr), payerAta = getAssociatedTokenAddressSync(MINT, payer);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: house.publicKey, blockhash, lastValidBlockHeight })
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
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
  const res = await conn.confirmTransaction({ signature: sig, blockhash: expected.blockhash, lastValidBlockHeight: expected.lastValidBlockHeight }, 'confirmed');
  if (res.value.err) throw new Error('Transação falhou: ' + JSON.stringify(res.value.err));
  return sig;
}

// ---- reembolso: casa -> jogador
export async function refund(toStr, usd, memo) {
  const to = new PublicKey(toStr), toAta = getAssociatedTokenAddressSync(MINT, to);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: house.publicKey, blockhash, lastValidBlockHeight })
    .add(createAssociatedTokenAccountIdempotentInstruction(house.publicKey, toAta, to, MINT))
    .add(createTransferCheckedInstruction(houseAta, MINT, toAta, house.publicKey, units(usd), DECIMALS)).add(memoIx(memo));
  tx.sign(house);
  const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (res.value.err) throw new Error('Reembolso falhou: ' + JSON.stringify(res.value.err));
  return sig;
}

// ---- prêmio: compra o pacote e entrega ao vencedor
const gacha = async (path, body) => {
  const r = await fetch(GACHA + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(API_KEY ? { 'x-api-key': API_KEY } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  let j = null; try { j = await r.json(); } catch { /* corpo vazio */ }
  return { status: r.status, body: j };
};
const ownerOfCoreAsset = async addr => { const a = await conn.getAccountInfo(new PublicKey(addr)); return a ? new PublicKey(a.data.subarray(1, 33)).toBase58() : null; };   // Metaplex Core: [key:1][owner:32]
export async function buyPack(packCode, usdPrice, winnerStr) {
  if (usdPrice > MAX_PACK_USD) throw new Error(`Pacote de US$${usdPrice} acima do teto MAX_PACK_USD=${MAX_PACK_USD}`);
  new PublicKey(winnerStr);
  const bal = await houseBalances(); if (bal.usdc < usdPrice) throw new Error(`Saldo USDC da casa insuficiente (${bal.usdc} < ${usdPrice})`);
  const gen = await gacha('/api/generatePack', { playerAddress: house.publicKey.toBase58(), packType: packCode, altPlayerAddress: winnerStr });
  if (gen.status !== 200 || !gen.body?.transaction) throw new Error('generatePack falhou: ' + gen.status + ' ' + JSON.stringify(gen.body).slice(0, 200));
  const tx = VersionedTransaction.deserialize(Buffer.from(gen.body.transaction, 'base64')); tx.sign([house]);
  const sub = await gacha('/api/submitTransaction', { signedTransaction: Buffer.from(tx.serialize()).toString('base64') });
  if (sub.status !== 200 || !sub.body?.success) throw new Error('submitTransaction falhou: ' + sub.status + ' ' + JSON.stringify(sub.body).slice(0, 200));
  let open = null;
  for (let i = 0; i < 25; i++) {   // o pacote precisa ser aberto em até 2 h; normalmente é imediato
    open = await gacha('/api/openPack', { memo: gen.body.memo });
    if (open.body?.success && open.body.nft_address) break;
    if (!/WAITING/.test(JSON.stringify(open.body))) throw new Error('openPack falhou: ' + open.status + ' ' + JSON.stringify(open.body).slice(0, 200));
    await sleep(3000);
  }
  const o = open?.body; if (!o?.nft_address) throw new Error('openPack não confirmou a tempo (memo ' + gen.body.memo + ')');
  await sleep(1500);
  let owner = null; try { owner = await ownerOfCoreAsset(o.nft_address); } catch { /* só para log */ }
  const f = o.nftWon?.content?.files?.[0];
  return { memo: gen.body.memo, nft: o.nft_address, name: o.nftWon?.content?.metadata?.name || 'Card', rarity: o.rarity, insured: o.insuredValue, image: f?.cdn_uri || f?.uri || null, owner, delivered: owner === winnerStr };
}
