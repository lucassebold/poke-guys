// Personagens jogáveis e suas HABILIDADES (todas nossas, de design de jogo; usadas pelo navegador e pelo servidor).
// A ordem é a mesma de ROSTER em pokemon.js. Habilidades de personagem = só poderes (itens), nada de velocidade/física:
//   start  = poder com que começa a corrida (guardado até apertar F); só poderes que não precisam de alvo
//   likely = 3 poderes que ele encontra com mais frequência nas caixas (peso x PERK_BOOST no sorteio)
// Em salas COM PRÊMIO as habilidades ficam DESLIGADAS (todos começam sem poder e com as mesmas chances).
export const PERK_BOOST = 1.8;

export const ROLES = {
  speedster: { name: 'Speedster', blurb: 'Starts with a burst of speed.' },
  defender: { name: 'Defender', blurb: 'Starts with a shield against the first hit.' },
  trickster: { name: 'Trickster', blurb: 'Starts with a banana trap ready to drop.' },
  leaper: { name: 'Leaper', blurb: 'Starts with a mega jump for the first big gap.' },
};

const C = (role, start, likely, tag) => ({ role, start, likely, tag });
export const CHARS = [
  C('speedster', 'turbo', ['thunder', 'turbo', 'jump'], 'Lightning-fast and full of sparks.'),          // Pikachu
  C('leaper', 'jump', ['boot', 'jump', 'thunder'], 'Hot-headed. Leaps first, thinks later.'),           // Charmander
  C('defender', 'shield', ['slime', 'shield', 'banana'], 'Tough and patient. Plants traps and slime.'),  // Bulbasaur
  C('defender', 'shield', ['slime', 'shield', 'tongue'], 'Hides in its shell and strikes back.'),        // Squirtle
  C('leaper', 'jump', ['tongue', 'slime', 'jump'], 'Bounces over trouble and sings past rivals.'),       // Jigglypuff
  C('trickster', 'banana', ['slime', 'banana', 'thunder'], 'Chaos magnet. Nobody knows what it will do.'), // Psyduck
  C('speedster', 'turbo', ['tongue', 'turbo', 'boot'], 'Quick, flexible, always has a plan.'),            // Eevee
  C('defender', 'shield', ['boot', 'shield', 'thunder'], 'A wall on legs. Hard to stop, harder to pass.'), // Snorlax
  C('trickster', 'banana', ['tongue', 'banana', 'boot'], 'Sneaky and greedy. Loves a good swap.'),        // Meowth
  C('trickster', 'banana', ['slime', 'tongue', 'thunder'], 'A shadowy prankster that slips past rivals.'), // Gengar
  C('defender', 'shield', ['shield', 'jump', 'tongue'], 'Lucky charm. Things just work out for it.'),     // Togepi
  C('speedster', 'turbo', ['turbo', 'slime', 'shield'], 'Cool-headed sprinter with great timing.'),       // Piplup
  C('leaper', 'jump', ['slime', 'banana', 'jump'], 'Small, slippery and surprisingly bouncy.'),           // Oddish
  C('trickster', 'banana', ['boot', 'banana', 'shield'], 'Lonely fighter. Hits hard when cornered.'),     // Cubone
  C('speedster', 'turbo', ['slime', 'turbo', 'tongue'], 'Slippery swimmer who dashes through gaps.'),     // Poliwag
  C('leaper', 'jump', ['tongue', 'jump', 'boot'], 'The alternate Eevee: more daring, jumps higher.'),    // Eevee 2
];
