// Childcare section: the vocabulary a young child (or a caregiver talking with one) needs most, grouped for
// browsing, plus a "needs" board of the words that matter right now (hurt, potty, hungry...).
// Pure data + helpers (tested in Node by tests/childcare.test.js); the page wiring is in app.js.
//
// Word list: the 250 signs of Google's "Isolated Sign Language Recognition" set (PopSign recordings, a
// child first-words vocabulary) plus care and health words added from ASL Citizen. Categories are ours.
(function (root) {
  const C = {
    needs: ['Needs & body', 'cyan'], feel: ['Feelings', 'amber'], people: ['People', 'jade'], food: ['Food & drink', 'jade'],
    home: ['Home & things', 'muted'], clothes: ['Clothes', 'muted'], animals: ['Animals', 'muted'], nature: ['Outside & weather', 'muted'],
    act: ['Doing', 'muted'], talk: ['Talking & questions', 'muted'], describe: ['Describing', 'muted'], time: ['Time & places', 'muted'],
  };
  // key: model label (lower case, no spaces as in the data) -> [display word, category]
  const W = {
    // needs & body
    owie: ['hurt (owie)', 'needs'], hurt: ['hurt', 'needs'], pain: ['pain', 'needs'], potty: ['potty', 'needs'], hungry: ['hungry', 'needs'],
    thirsty: ['thirsty', 'needs'], sleepy: ['sleepy', 'needs'], sick: ['sick', 'needs'], nap: ['nap', 'needs'], sleep: ['sleep', 'needs'],
    help: ['help', 'needs'], more: ['more', 'needs'], finish: ['finished / all done', 'needs'], wait: ['wait', 'needs'], stop: ['stop', 'needs'],
    doctor: ['doctor', 'needs'], medicine: ['medicine', 'needs'], diaper: ['diaper', 'needs'], bath: ['bath', 'needs'], shower: ['shower', 'needs'],
    wet: ['wet', 'needs'], dirty: ['dirty', 'needs'], clean: ['clean', 'needs'], hot: ['hot', 'needs'], cold: ['cold', 'needs'],
    head: ['head', 'needs'], ear: ['ear', 'needs'], eye: ['eye', 'needs'], nose: ['nose', 'needs'], mouth: ['mouth', 'needs'],
    tooth: ['tooth', 'needs'], tongue: ['tongue', 'needs'], lips: ['lips', 'needs'], chin: ['chin', 'needs'], cheek: ['cheek', 'needs'],
    face: ['face', 'needs'], hair: ['hair', 'needs'], arm: ['arm', 'needs'], finger: ['finger', 'needs'], feet: ['feet', 'needs'],
    toothbrush: ['toothbrush', 'needs'], stuck: ['stuck', 'needs'],
    // feelings
    happy: ['happy', 'feel'], sad: ['sad', 'feel'], mad: ['mad', 'feel'], cry: ['cry', 'feel'], scared: ['scared', 'feel'],
    like: ['like', 'feel'], hate: ['hate', 'feel'], smile: ['smile', 'feel'], kiss: ['kiss', 'feel'], love: ['love', 'feel'],
    fine: ['fine', 'feel'], bad: ['bad', 'feel'], yucky: ['yucky', 'feel'], cute: ['cute', 'feel'], pretty: ['pretty', 'feel'],
    // people
    mom: ['mom', 'people'], dad: ['dad', 'people'], grandma: ['grandma', 'people'], grandpa: ['grandpa', 'people'],
    brother: ['brother', 'people'], aunt: ['aunt', 'people'], uncle: ['uncle', 'people'], boy: ['boy', 'people'], girl: ['girl', 'people'],
    child: ['child', 'people'], baby: ['baby', 'people'], man: ['man', 'people'], person: ['person', 'people'], police: ['police', 'people'],
    fireman: ['firefighter', 'people'], cowboy: ['cowboy', 'people'], clown: ['clown', 'people'], yourself: ['yourself', 'people'],
    weus: ['we / us', 'people'], hesheit: ['he / she / it', 'people'], minemy: ['mine / my', 'people'], who: ['who', 'talk'],
    // food & drink
    milk: ['milk', 'food'], water: ['water', 'food'], drink: ['drink', 'food'], food: ['food', 'food'], snack: ['snack', 'food'],
    apple: ['apple', 'food'], carrot: ['carrot', 'food'], cereal: ['cereal', 'food'], chocolate: ['chocolate', 'food'],
    frenchfries: ['french fries', 'food'], gum: ['gum', 'food'], icecream: ['ice cream', 'food'], nuts: ['nuts', 'food'],
    orange: ['orange', 'food'], pizza: ['pizza', 'food'], taste: ['taste', 'food'], napkin: ['napkin', 'food'],
    // home & things
    bed: ['bed', 'home'], bedroom: ['bedroom', 'home'], room: ['room', 'home'], home: ['home', 'home'], table: ['table', 'home'],
    chair: ['chair', 'home'], closet: ['closet', 'home'], drawer: ['drawer', 'home'], lamp: ['lamp', 'home'], TV: ['TV', 'home'],
    radio: ['radio', 'home'], refrigerator: ['fridge', 'home'], vacuum: ['vacuum', 'home'], dryer: ['dryer', 'home'],
    glasswindow: ['window', 'home'], stairs: ['stairs', 'home'], garbage: ['garbage', 'home'], book: ['book', 'home'],
    story: ['story', 'home'], toy: ['toy', 'home'], doll: ['doll', 'home'], puzzle: ['puzzle', 'home'], balloon: ['balloon', 'home'],
    gift: ['gift', 'home'], pen: ['pen', 'home'], pencil: ['pencil', 'home'], scissors: ['scissors', 'home'], penny: ['penny', 'home'],
    flag: ['flag', 'home'], callonphone: ['phone call', 'home'], backyard: ['backyard', 'home'],
    // clothes
    shirt: ['shirt', 'clothes'], jacket: ['jacket', 'clothes'], jeans: ['jeans', 'clothes'], hat: ['hat', 'clothes'], shoe: ['shoe', 'clothes'],
    mitten: ['mitten', 'clothes'], pajamas: ['pajamas', 'clothes'], underwear: ['underwear', 'clothes'], zipper: ['zipper', 'clothes'],
    // animals
    dog: ['dog', 'animals'], puppy: ['puppy', 'animals'], kitty: ['kitty (cat)', 'animals'], cat: ['cat', 'animals'], bird: ['bird', 'animals'],
    fish: ['fish', 'animals'], cow: ['cow', 'animals'], pig: ['pig', 'animals'], horse: ['horse', 'animals'], duck: ['duck', 'animals'],
    goose: ['goose', 'animals'], hen: ['hen', 'animals'], owl: ['owl', 'animals'], mouse: ['mouse', 'animals'], frog: ['frog', 'animals'],
    bee: ['bee', 'animals'], bug: ['bug', 'animals'], donkey: ['donkey', 'animals'], elephant: ['elephant', 'animals'],
    giraffe: ['giraffe', 'animals'], lion: ['lion', 'animals'], tiger: ['tiger', 'animals'], wolf: ['wolf', 'animals'],
    zebra: ['zebra', 'animals'], alligator: ['alligator', 'animals'], animal: ['animal', 'animals'], farm: ['farm', 'animals'],
    // outside & weather
    outside: ['outside', 'nature'], tree: ['tree', 'nature'], flower: ['flower', 'nature'], grass: ['grass', 'nature'], sun: ['sun', 'nature'],
    moon: ['moon', 'nature'], cloud: ['cloud', 'nature'], rain: ['rain', 'nature'], snow: ['snow', 'nature'], pool: ['pool', 'nature'],
    car: ['car', 'nature'], boat: ['boat', 'nature'], airplane: ['airplane', 'nature'], helicopter: ['helicopter', 'nature'],
    store: ['store', 'nature'],
    // doing
    go: ['go', 'act'], come: ['come', 'act'], stay: ['stay', 'act'], eat: ['eat', 'act'], play: ['play', 'act'], read: ['read', 'act'],
    see: ['see', 'act'], look: ['look', 'act'], hear: ['hear', 'act'], listen: ['listen', 'act'], find: ['find', 'act'], hide: ['hide', 'act'],
    give: ['give', 'act'], have: ['have', 'act'], haveto: ['have to', 'act'], make: ['make', 'act'], cut: ['cut', 'act'], drop: ['drop', 'act'],
    fall: ['fall', 'act'], jump: ['jump', 'act'], dance: ['dance', 'act'], ride: ['ride', 'act'], blow: ['blow', 'act'], touch: ['touch', 'act'],
    open: ['open', 'act'], close: ['close', 'act'], wake: ['wake up', 'act'], awake: ['awake', 'act'], think: ['think', 'act'],
    pretend: ['pretend', 'act'], dry: ['dry', 'act'], talk: ['talk', 'talk'], say: ['say', 'talk'],
    // talking & questions
    yes: ['yes', 'talk'], no: ['no', 'talk'], please: ['please', 'talk'], thankyou: ['thank you', 'talk'], hello: ['hello', 'talk'],
    bye: ['bye', 'talk'], where: ['where', 'talk'], why: ['why', 'talk'], if: ['if', 'talk'], because: ['because', 'talk'], not: ['not', 'talk'],
    shhh: ['shh (quiet)', 'talk'], can: ['can', 'talk'], will: ['will', 'talk'], that: ['that', 'talk'], there: ['there', 'talk'],
    for: ['for', 'talk'], same: ['same', 'talk'],
    // describing
    big: ['big', 'describe'], high: ['high', 'describe'], up: ['up', 'describe'], down: ['down', 'describe'], on: ['on', 'describe'],
    into: ['into', 'describe'], beside: ['beside', 'describe'], fast: ['fast', 'describe'], loud: ['loud', 'describe'], noisy: ['noisy', 'describe'],
    quiet: ['quiet', 'describe'], old: ['old', 'describe'], empty: ['empty', 'describe'], sticky: ['sticky', 'describe'], all: ['all', 'describe'],
    any: ['any', 'describe'], another: ['another', 'describe'], every: ['every', 'describe'], many: ['many', 'describe'], better: ['better', 'describe'],
    first: ['first', 'describe'], red: ['red', 'describe'], blue: ['blue', 'describe'], green: ['green', 'describe'], yellow: ['yellow', 'describe'],
    white: ['white', 'describe'], black: ['black', 'describe'], brown: ['brown', 'describe'],
    // time & places
    now: ['now', 'time'], later: ['later', 'time'], after: ['after', 'time'], before: ['before', 'time'], time: ['time', 'time'],
    morning: ['morning', 'time'], night: ['night', 'time'], tomorrow: ['tomorrow', 'time'], yesterday: ['yesterday', 'time'],
  };
  // The words that matter most in a care setting, in the order they appear on the needs board.
  const NEEDS = ['owie', 'potty', 'hungry', 'thirsty', 'sleepy', 'sick', 'more', 'finish', 'help', 'wait', 'mom', 'dad'];

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const BY_NORM = {};
  for (const k of Object.keys(W)) BY_NORM[norm(k)] = k;
  for (const [k, [w]] of Object.entries(W)) if (!BY_NORM[norm(w)]) BY_NORM[norm(w)] = k;   // display words map too ('hurt (owie)')

  function entry(label) {                     // model label (any case) -> {key, word, cat, catLabel}
    const k = BY_NORM[norm(label)];
    if (!k) return null;
    const [word, cat] = W[k];
    return { key: k, word, cat, catLabel: C[cat][0] };
  }
  // Index list of a model's labels that are childcare words (used to limit a general model to them).
  function allowed(labels) {
    const s = new Set();
    labels.forEach((l, i) => { if (entry(l)) s.add(i); });
    return s;
  }
  function grouped(filter) {                  // [{cat, label, words: [{key, word}]}], filter = substring
    const f = norm(filter);
    return Object.entries(C).map(([cat, [label]]) => ({
      cat, label,
      words: Object.entries(W).filter(([k, [w, c]]) => c === cat && (!f || norm(w).includes(f) || norm(k).includes(f)))
        .map(([k, [w]]) => ({ key: k, word: w })).sort((a, b) => a.word.localeCompare(b.word)),
    })).filter(g => g.words.length);
  }
  const api = { CATS: C, WORDS: W, NEEDS, entry, allowed, grouped, norm, size: Object.keys(W).length };
  root.SBChildcare = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
