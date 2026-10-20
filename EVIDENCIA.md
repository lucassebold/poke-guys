# Evidência — de onde vem cada item

Alvo: `D:\Steam\steamapps\common\Stumble Guys\Stumble Guys.exe`
Método: REA (`inspect_pe_resources`, `inspect_managed_artifact`, `open_binary`) + leitura estática dos arquivos do jogo.
**Limite honesto:** o provedor de disassembly do REA (Ghidra/IDA) não está configurado nesta máquina
(`binary_overview` → `provider_unavailable`). Portanto **nenhum código nativo foi decompilado** e
**nenhum valor numérico de gameplay foi extraído**. Só existe evidência de *nomes* (o que o jogo tem), não de *números* (como ele se comporta).

## A. Identidade do alvo (observado)

| Item | Evidência |
|---|---|
| `Stumble Guys.exe` é PE x64 nativo, 278.016 bytes, sem CLI/.NET | REA `inspect_managed_artifact` ev_1ed6de25…bcd6069 → `classification: not-managed`, `cli-directory-absent`; SHA-256 `9a1198b2ed04e6ac5192876ec0845eaea351db3a56f9bdedf56c30a117642c11` |
| É o *launcher* do Unity (ícones, sem lógica) | REA `inspect_pe_resources` ev_0cc2d3d3…e097 → só 10 ícones (16–256 px) + manifest/version; 13 recursos |
| Unity **6000.0.68** | `UnityPlayer.dll`, string UTF-16 `6000.0.68.148054` |
| Backend de script = **IL2CPP** | existem `GameAssembly.dll` (120 MB) e `il2cpp_data/Metadata/global-metadata.dat`; não há pasta `Managed/` |
| Metadata IL2CPP **v31**, sem criptografia | `global-metadata.dat` bytes 0–7 = `AF 1B B1 FA 1F 00 00 00` (magic `0xFAB11BAF`, versão 31); tabela de strings legível (228.718 strings) |
| Estúdio / produto | `Stumble Guys_Data/app.info` = `Kitka Games` / `Stumble Guys`; namespace `KitkaGames` na metadata |
| Dados do jogo em AssetBundle Unity | `data.unity3d` (75,7 MB) começa com `UnityFS` — **não** foi aberto (sem ferramenta de extração) |

## B. Mecânicas implementadas ↔ nomes encontrados em `global-metadata.dat`

Formato: mecânica nossa → identificadores reais (presença confirmada na tabela de strings).

| Mecânica no nosso jogo | Identificadores encontrados |
|---|---|
| Pular | `JumpAction` |
| Mergulhar (dive) | `Dive`, `DiveAbilityData`, `DiveAbilityConfig`, `DivePlayerAbility`, `DiveActive` |
| Checkpoint + respawn | `CheckpointData`, `CheckpointRespawnAuthoring`, `EntityComponentPlayerRespawn`, `GameplayLastCheckpoint`, `CheckpointResetHeight`, `HeightRespawn`, `_lastCheckpointReached` |
| Cair e renascer no checkpoint | `CheckpointResetHeight`, `HeightRespawn` |
| Linha de chegada | `FinishLineCheckpoint`, `FinishLine`, `NumberPlayersReachedFinishLine` |
| Classificar / eliminar (N vagas) | `Qualified`, `Eliminated`, `IsEliminated`, `QualifyingPlayers`, `_numberOfQualifiedPlayers`, `OnPlayerQualifiedUI`, `PlayerElimination` |
| Contagem regressiva | `StartCountdown`, `RunCountdown`, `OnCountdownEnds`, `UICountdown` |
| Knockback (empurrão) | `Knockback`, `KnockbackYForce`, `KnockbackMultiplier`, `HitKnockbackForce` |
| Martelo/barra giratória | `Toy_HammerObstacle`, `Toy_HammerTrap`, `Toy_SwingObstacleHammer`, `SpinHammer`, `BakeSpinningDisc` |
| Esteira | `Conveyor`, `ConveyorEntity`, `ConveyorChangeDirectionStarted` |
| Trampolim | `DynamicTrampoline`, `ApplyTrampolineBounce`, `EntityComponentToggleableTrampoline` |
| Bumpers | `BumperField`, `BumperFieldAbilityConfig`, `BumperFieldPlayerAbility` |
| Bots/IA | `AIJumpMovingObstacleSettingsAsset`, `AIObstacleJumpSettingsAsset`, `AIRandomJumpSettingsAsset`, `EntityComponentAIObstacleJump` |

Presença de nome ≠ comportamento idêntico. Ex.: `Toy_Fan`, `LavaWall`, `Cannon` também existem no jogo, mas **não** foram implementados aqui.

## C. NÃO é evidência — escolha nossa (ver `CFG` em `main.js`)

Velocidade (7), gravidade (-28), pulo (11), velocidade/duração do dive, força do knockback, tempo de atordoamento,
16 corredores, 8 vagas, 120 s, 3 s de contagem, layout do percurso, cores, modelo do boneco, comportamento dos bots.
Nenhum desses números veio do binário. O boneco (cápsulas), o layout da fase, o céu/mar e a lógica são nossos; **texturas, malhas e sons vêm do jogo** (ver seção E).

## D. Como obter evidência numérica de verdade (próximo passo)

1. Configurar `GHIDRA_INSTALL_DIR` (Ghidra 12.1.x + Java) para o REA abrir `GameAssembly.dll`.
2. Mapear RVAs de métodos com os metadados (`Il2CppDumper`/equivalente) para nomear funções como `DivePlayerAbility`.
3. Ler constantes em `DiveAbilityConfig`/`BumperFieldConfig` etc. nos assets de `data.unity3d` (precisa de extrator UnityFS).


## E. Assets extraídos do jogo (observado)

Origem: `Stumble Guys_Data/StreamingAssets/aa/StandaloneWindows64/*.bundle` (1.246 bundles Addressables, UnityFS), lidos com UnityPy 1.25.4
(inventário: 55.128 objetos — 20.084 Texture2D, 555 AudioClip, 11.333 Mesh). Arquivos em `assets/`.

| Tipo | Nomes originais no jogo |
|---|---|
| Sons (WAV, via FMOD) | `SG_SFX_Jump`, `SG_SFX_SkySlide_Dive_Activate`, `SG_SFX_Landing`, `SG_SFX_Footstep`, `SG_SFX_Hit`, `SG_SFX_Brawler_Weapon_Hammer_Hit`, `SG_SFX_Prop_SwingBlade_Impact_01`, `SG_SFX_Bounce_Pinball_DingImpact`, `SG_SFX_LT_Springboard`, `SG_SFX_WaterSplash_DunkPlop`, `SG_SFX_PropHunt_Countdown_321_v2`, `SG_SFX_Qualified`, `SG_SFX_Eliminated`, `SG_SFX_Victory`, `SG_SFX_Button_Click`, `SG_SFX_RT_ConveyorBelt_01_Loop`, música `SG_MUS_Classic_FunkyRoad_Loop` (64 s) |
| Texturas (PNG) | `TEX_JungleGrass_A_000` (cortei a faixa escura inferior), `TEX_CommonConcreteTiles01_…`, `TEX_FloorTiles_Stone_A_000_Ti`, `TEX_RocketDoomMetalfloor_A_000_Ti`, `TEX_Trampoline_A_000_Ti`, `TEX_MichelangeloFinishLine_A_000_Bs`, `TEX_CheckerColoured_A_000_Ti`, `TEX_SkyboxGradientBlueWithSand_A_000_Ti` (céu), `SwingObstacleHammer`, `Bumper1`, `TrampolineRound2` |
| Malhas (OBJ) | `MSH_SwingObstacleHammer_A_000_LOD0` (só a cabeça), `SwingObstacleHammerAxle`, `Bumper`, `TrampolineRound` |

Observações: o clipe de contagem do jogo é de PropHunt (não há "321" genérico no inventário); o martelo do jogo é pêndulo, aqui uso a cabeça numa barra giratória (escolha nossa);
as texturas do jogo são majoritariamente cores chapadas (estilo cartoon) — o aspecto liso é fiel a elas.
**Uso:** material protegido da Kitka Games/Scopely extraído de uma cópia instalada; manter apenas local, não redistribuir.

## F. Ferramentas instaladas (nesta máquina)

JDK Temurin 21.0.12 em `D:	ools\jdk`, Ghidra 12.1.4 em `D:	ools\ghidra`, venv Python com UnityPy em `D:	oolsenv`.
`rea doctor` (CLI, com as variáveis) → provedor ghidra **healthy**. `~/.claude.json` (entrada `rea`) ganhou `env` com `GHIDRA_INSTALL_DIR` e `JAVA_HOME`
(backup: `~/.claude.json.bak-rea-ghidra`); só vale após reiniciar o servidor MCP do REA. **Nenhuma decompilação do `GameAssembly.dll` foi feita ainda.**

## G. Personagens (escolha de design, sem evidência do binário)

Os 16 corredores são Pokémon (Pikachu = jogador), montados em `pokemon.js` com esferas/cones/cilindros desenhados à mão — **nenhum modelo, textura ou arte oficial foi usado**.
É fan-art de uso pessoal; Pokémon é marca da Nintendo/Game Freak/The Pokémon Company. O Stumble Guys original não tem esses personagens.

## H. Animações do personagem (REA dos bundles — observado)

**Método:** o REA MCP não lê AssetBundles do Unity e o provedor Ghidra ainda não está ativo no servidor MCP (precisa reiniciar), então a engenharia reversa foi feita
nos dados serializados com UnityPy 1.25.4 + decodificadores próprios (`tools/`). Saídas brutas em `evidence/`.

| Item | Evidência |
|---|---|
| Existe um Animator do personagem base | `Assets/DLC/Animations/Controller/Core/StumblerController.controller` (catálogo Addressables) |
| **Parâmetros** | `velocity:float, grounded, jumping, falling, sliding, stunned, emote:bool, Punch/SlideKick/Emote/Victory…:trigger` e mais 30 (habilidades/armas) — `evidence/animator_StumblerController.txt` |
| **18 estados** | Idle (padrão), Fall, Run, Jump (speed 1.5), Slide, SlideExit, SlideExitToRun, GetUp, Ragdoll (speed 1.5), Victory, Emote, HumanoidToTransformed…, Startup/Active/Recovery |
| **Transições** | Idle→Run: `velocity>0.5 & grounded & !sliding`, blend 0.15 s · Idle/Run→Fall: `!grounded & falling`, blend 0.05 s · →Jump: `jumping`, blend 0 · →Slide: `sliding`, blend 0 · Slide→SlideExit (`velocity<1`) / SlideExitToRun (`velocity>1`) · SlideExit→Idle blend 0.25 s · Ragdoll→GetUp→Idle quando `!stunned` (blend 0.15 s). Nenhuma transição tem *exit time* (saem na hora que a condição vale) |
| **Duração dos clips** (`AnimationClip`, `m_StopTime`) | Run 0.75 s (loop, 60 fps) · Idle 2.0 s · Jump 1.767 s · JumpLand 0.333 s · Fall 1.0 s · Slide 1.333 s · SlideExit 0.833 s · SlideExitToRun 0.5 s · RagAir/RagRoll 1.333 s — `evidence/anim_clips_metadata.txt` |
| **Esqueleto (19 ossos, Avatar `StumblerArmatureAvatar`)** | `Player_Armature/Root` → `Spine` → `Head`; `Spine/Clavicle.L|R/UpperArm/LowerArm/Hand`; `Root/UpperLeg.L|R/LowerLeg/Foot` |
| **Amplitudes do ciclo Run** (decodificação dos clips streamed+dense+constant, oscilação pico a pico) | UpperLeg.R 101°, UpperLeg.L 99°, LowerLeg.R 106°, LowerLeg.L 72°, Foot 85–95°, LowerArm 46°; pernas L/R em oposição de fase — `evidence/anim_run_idle_bone_swing.txt` |
| **Idle** | respiração leve: Spine 7,6°, Head 7,5°, Hand ~21° (pico a pico), ciclo de 2 s |
| Posição da raiz no Run | constante (nenhum "bob" vertical gravado no clip) |

**O que usamos:** a máquina de estados inteira (condições, limiares 0.5/1.0, blends, speeds) e os períodos/amplitudes do Run/Idle — em `anim.js`.
**Não evidenciado (escolha nossa):** poses de Jump/Fall/Slide/Ragdoll (os clips de pose usam hashes de ossos não resolvidos), o comprimento do clip GetUp,
a transição *Any State → Ragdoll* (não aparece no dump do controller; inferida), e o corpo dos Pokémon (o clip humanoide não se aplica a eles, então balançamos pés/braços em pivôs).
Eixo de rotação e osso exato de um osso extra com 60° de torção no Run (hash `1843479144`) não foram resolvidos — **não usado**.

## I. Fases (REA das cenas — observado)

| Item | Evidência |
|---|---|
| 80 cenas de fase no catálogo | `Assets/Scenes/*.unity` (`level1_whirly` … `level30_Jumping`, `L_035…L_093`, `IPL_…`, `SSL_…`, `eventlevel…`) |
| 80 assets de mapa Quantum | `Assets/DLC/Levels/DB/Levels/*_Map.asset` — formato binário do Photon Quantum, **não decodificado** (sem typetree; precisa do SDK/IL2CPP) |
| Lógica de jogo é determinística (Quantum) | scripts `Entity*`, `qprefab`, `Quantum`… no metadata; cena guarda só a parte visual + marcadores |
| Estrutura de cada fase lida das cenas | contagens por tipo em `evidence/levels_table.txt` (131 linhas = 80 cenas + aliases por hash do catálogo) |
| Marcadores reais de gameplay | `BoxStaticCollider` (escala do Transform = tamanho do bloco), `Spawn`, `Checkpoint_Spawn`, `GoalPlatform`, `MovingPlatform`+filhos `A`/`B`, `SpinnyHammer`, `AI_Waypoint`, `AI_Trigger_*` |
| `level7_moving` | 629 objetos 3D, 62 `BoxStaticCollider` (39 alinhados a eixos usados; 23 girados — cantos diagonais/pás — **omitidos**), 34 `MovingPlatform` (cada uma 4×0,5×4 m entre A e B), 4 checkpoints (z −36,3 / −12,3 / −0,4 / 14,2), `GoalPlatform` em z 34,0 y 4,17, 2 martelos, 52 waypoints de IA; percurso ≈ 18,4 × 5,9 × 79 m — `evidence/level7_moving_scene_tree.json` |

**Reconstrução:** curso 2 do jogo (`levels/level7_moving.json` → `buildLevel7` em `main.js`) usa posições/tamanhos reais. Giramos o mapa 180° em Y para correr para −Z.
**Escolhas nossas nessa fase:** velocidade das plataformas (2 m/s; a do jogo vem do Quantum), comprimento/velocidade do martelo, texturas por tamanho de bloco, a pá `MovingBar` (omitida), fase aleatória dos movers.
**Bots:** seguem os `AI_Waypoint` reais (trilha mais próxima lateralmente, já que há 3 trilhas paralelas); waypoints fora do piso foram puxados para o centro.
Teste: 13–15 de 15 bots terminam em ~17 s; na fase 1, 8+ classificam em ~75 s.

**Limites:** só `level7_moving` foi reconstruída; as outras 130 cenas estão apenas inventariadas. Fases com muita geometria girada (rampas: `level3_ice`, `level6_hill`…) exigiriam colisão não alinhada aos eixos.

## J. Câmera de espectador (REA — observado)

| Item | Evidência |
|---|---|
| O jogo tem modo espectador de verdade | metadata IL2CPP: `StartSpectatingModeForLocalPlayer`, `NextSpectate`, `PreviousSpectate`, `FindSpectateTarget(availablePlayers, _spectateIndex)`, `ValidateSpectateIndex`, `SpectateIndex`, `TargetSpectatePlayer`, `UpdateSpectatedTarget`, `HandleSpectateCamera`, `SpectateModeZoomMultiplier`, `SetSkipSpectateModeZoomIn`, `LastSpectationJumpTimestamp` (cooldown entre trocas), `SpectateCountdownTimer`, `AreAllPlayersSpectating`, `UISpectateMode` |
| Prefab de UI `UISpectateMode` (bundle `52df38bf…`) | `LeftButton` e `RightButton` (zonas de toque de 640 px nas laterais, altura total) · `Description` ancorada embaixo-centro · variantes `Description (Mobile)/(Console)/(Steam)` com ícones `SwitchToNext/SwitchToPrevious` · `QualifiedArea` no canto superior direito com `Description` + `TimeLeft` |
| Textos reais | `Spectating`, `Tap to follow next player`, `Switch Target`, `Time left`, `QUALIFIED!`, `ELIMINATED!`, `ROUND OVER!`, `FINISHED 3rd` (formato do resultado) |

**Aplicado:** ao terminar (qualificado ou não) o jogador fica parado na chegada (antes ele "andava" e caía de volta ao checkpoint), toca a animação de vitória se classificou, e a câmera passa a seguir os que ainda correm (líder primeiro). Trocar de alvo: ◀ ▶ (ou A/D) ou clicar nos 1/3 laterais da tela; cooldown de 0,25 s; ao entrar, a câmera aproxima; UI com "Spectating", nome do alvo, "Switch Target", e "Time left" no canto. Sem alvos vivos segue os vencedores.
**Nossos (sem dado no binário):** cooldown 0,25 s, distância 9→7,4 m, o critério "líder primeiro", o pulinho/pose da vitória (o estado `Victory` existe no controller; a pose não).

## K. Visual do mundo (REA dos materiais — observado)

| Item | Evidência |
|---|---|
| Shader dos materiais de fase | `Stumble/Environment/MainEnvironmentShader` = `_MainTex` × `_Color` (texturas cinza-claras **tingidas** por material) |
| Cores reais na `level7_moving` | Level7Floor `groundTexture1` × (0,89; 0,24; 0,32) · level7_wall `wallTexture` × (0; 0,38; 0,37) · floor_goal `groundTexture1` × (1; 0,65; 0,34) · plataformas `Level7Platform` · highlight `texturetest3` × (1; 0,83; 0,38) · GreenFloor `prototypeGround` × (0,23; 0,75; 0,26) |
| Céu da fase | `Stumble/Environment/SkyboxShader`: `_ColorGradient`=`blueGradient` (1×256, simétrico: claro no meio) + `_MainTex`=`skybox_clouds` (512², máscara de nuvem em alfa) × `_Color` (0,38; 0,86; 1,0); `RenderSettings` ambient tri-light (céu 0,63/0,69/0,80; equador 0,11/0,13/0,13; chão 0,05/0,04/0,04); fog desligado; skybox padrão `Skybox/Procedural` (exposure 1,3) |
| Chegada e bandeiras | texturas `Goal1` (banner vermelho "FINISH"), `FlagpoleTexture` (logo Stumble Guys), `Fencepost` |
| Água | texturas `TEX_HSWater_A_000_Ti` e `Mat_waterTextureDark` |
| Palmeiras/ilhas | malhas `Level12Palm1/2`, `Island1/2` + textura `Level12Palm`, `TEX_Sand_A_000_Ti` |

**Aplicado (`env.js`, `main.js`):** céu em domo com o gradiente + camadas de nuvem do jogo (animadas) e sol; mar com a textura de água do jogo em 2 camadas animadas; nuvens 3D e ilhas com palmeiras ao redor da fase; grama procedural + ~10 mil lâminas instanciadas balançando ao vento; plataformas com borda, laterais de pedra e colunas até o mar; bandeiras com o logo e arco com o banner `FINISH` reais nos checkpoints/chegada; a fase 2 usa as cores/texturas reais acima.
**Nossos (design):** composição do shader do céu, mar (blend e velocidade), nuvens de esferas, ilhas (o monte de areia é a malha real; o disco verde e a distribuição são nossos), grama, colunas e bordas, classificação de blocos em floor/wall/goal por tamanho.

## L. Catálogo de fases (12)

| # | Fase | Origem | Mecânica principal | Ambiente |
|---|---|---|---|---|
| 1 | Practice Course | **nossa** | tour de tudo: pedras, esteira + martelos, bumpers, trampolim, barras altas | dia |
| 2 | Moving | **reconstruída** de `level7_moving` (dados reais, §I) | plataformas móveis A↔B, martelo, postes | dia, cores reais |
| 3 | Hammer Alley | nossa | 4 trechos de martelos (hubs na pista, pares em viga estreita) | pôr do sol |
| 4 | Bumper Garden | nossa | campos de bumpers com grades baixas, martelos, ilhas | verde-água |
| 5 | Ice Rink | nossa | piso de gelo (aceleração 9 %), blocos, varredores laterais | frio |
| 6 | Falling Tiles | nossa | pisos que caem 0,5 s após o pisar (voltam em 4,5 s), buracos, zigue-zague | deserto |
| 7 | Trampoline Towers | nossa | 5 torres, subida só por trampolins (≈ 30 m de altura) | céu |
| 8 | Conveyor Chaos | nossa | esteiras em 3 direções, blocos varredores, esteiras a favor/contra | industrial |
| 9 | Sweeper Bridge | nossa | vigas de 3,4 m com barras que varrem a pista (pular no tempo) | crepúsculo |
| 10 | Sky Hop | nossa | pads flutuantes: fixos, horizontais, verticais, que piscam | rosa |
| 11 | Stairway to Sky | nossa | 26 degraus de 0,95 m, varredores e martelos | céu |
| 12 | Grand Finale | nossa | combina martelos, bumpers, trampolim, plataformas móveis, esteira, pisos que caem e viga | violeta |

**Só a fase 2 vem de dados do jogo.** As outras dez são desenhos nossos usando as mesmas peças (martelo, bumper, trampolim, esteira, plataforma móvel), com tempo de rodada por fase (120–200 s).
Tentei reconstruir mais fases reais (`level28_ufo`, `level4_pushy`, …): nelas o tamanho dos colisores não está na escala do Transform (fica no componente Quantum, não decodificado), então os dados exportados não são utilizáveis.
Teste com bots (13 corredores IA, 130 s simulados): todas as 12 fases são completáveis (5–15 bots terminam, dependendo do comprimento).
Novos mecanismos (todos nossos): gelo, pisos que caem, plataformas intermitentes, trampolim genérico, ambiente por fase (tinta do céu/horizonte, mar, sol), menu de seleção.

## M. Multiplayer (arquitetura — nossa)

Servidor Node (`server.js`, dependência `ws`) + os mesmos módulos de simulação no navegador (`shared/sim.js`, `shared/levels.js`).
Cada jogador simula o próprio boneco e envia a posição ~20×/s; o servidor roda os bots (mesma física), o relógio da rodada, os pisos que caem e a ordem de chegada, e devolve `snap` ~20×/s.
Salas de até 16; vagas vazias = bots; entrar no meio da corrida substitui o bot mais atrasado; ao sair, o boneco vira bot. Fim de rodada → tabela de resultados → próxima fase automática.
Testado: 17 clientes (o 17º abre uma 2ª sala), entrada no meio da corrida, cruzar a chegada, fim de rodada e avanço automático (clientes Node e navegador Edge real).
