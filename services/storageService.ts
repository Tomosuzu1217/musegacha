
import { Question, Answer, StoredImage, PersonaConfig, CharacterProfile, SavedConversation, ChatMessage, ConsultSession, UserInterestProfile, ActivityLogEntry } from '../types';

const KEYS = {
  QUESTIONS: 'musegacha_questions',
  ANSWERS: 'musegacha_answers',
  HISTORY: 'musegacha_history_ids',
  API_KEY: 'musegacha_api_key_v3', // v3: XOR encrypted storage
  IMAGES: 'musegacha_images',
  PERSONA_CONFIG: 'musegacha_persona_config_v2',
  CHARACTERS: 'musegacha_characters',
  CONVERSATIONS: 'musegacha_conversations',
  CONSULT_SESSIONS: 'musegacha_consult_sessions',
  USER_PROFILE: 'musegacha_user_profile',
  ACTIVITY_LOG: 'musegacha_activity_log',
};

// --- Security Configuration ---
const SECURITY_CONFIG = {
  MAX_QUESTION_LENGTH: 1000,
  MAX_SOURCE_LENGTH: 200,
  MAX_TAG_LENGTH: 50,
  MAX_NAME_LENGTH: 50,
  MAX_PERSONA_LENGTH: 500,
  MAX_ANSWER_LENGTH: 50000,
  MAX_QUESTIONS_COUNT: 500,
  MAX_ANSWERS_COUNT: 100,
  MAX_IMAGES_COUNT: 20,
  MAX_CHARACTERS_COUNT: 20,
  MAX_IMAGE_SIZE_BYTES: 500000, // 500KB
  MAX_CONVERSATIONS_COUNT: 10,
  MAX_CONSULT_SESSIONS: 50,
  MAX_CONSULT_MESSAGES: 100,
  MAX_ACTIVITY_LOG_ENTRIES: 500,
  MAX_CONCERN_LENGTH: 2000,
};

// --- Security Utilities ---

// Web Crypto API based encryption (AES-GCM)
const CRYPTO_CONFIG = {
  ALGORITHM: 'AES-GCM',
  KEY_LENGTH: 256,
  IV_LENGTH: 12,
  SALT_LENGTH: 16,
  ITERATIONS: 100000,
  VERSION_PREFIX: 'MGv4_',
};

// Device-specific seed for key derivation
const getDeviceSeed = (): string => {
  const storedSeed = localStorage.getItem('_mg_device_seed');
  if (storedSeed) return storedSeed;

  const newSeed = crypto.randomUUID() + '_' + Date.now();
  localStorage.setItem('_mg_device_seed', newSeed);
  return newSeed;
};

// Derive encryption key using PBKDF2
const deriveKey = async (salt: Uint8Array): Promise<CryptoKey> => {
  const encoder = new TextEncoder();
  const seed = getDeviceSeed();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(seed),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: CRYPTO_CONFIG.ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: CRYPTO_CONFIG.ALGORITHM, length: CRYPTO_CONFIG.KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
};

// Encrypt using AES-GCM
const encryptKeyAsync = async (plaintext: string): Promise<string> => {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // Generate random salt and IV
    const salt = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.IV_LENGTH));

    const key = await deriveKey(salt);

    const encrypted = await crypto.subtle.encrypt(
      { name: CRYPTO_CONFIG.ALGORITHM, iv },
      key,
      data
    );

    // Combine salt + iv + ciphertext
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Convert to base64 with version prefix
    return CRYPTO_CONFIG.VERSION_PREFIX + btoa(String.fromCharCode(...combined));
  } catch (e) {
    console.error('Encryption failed:', e);
    return '';
  }
};

// Decrypt using AES-GCM
const decryptKeyAsync = async (encrypted: string): Promise<string> => {
  try {
    // Handle v4 (AES-GCM)
    if (encrypted.startsWith(CRYPTO_CONFIG.VERSION_PREFIX)) {
      const combined = Uint8Array.from(
        atob(encrypted.slice(CRYPTO_CONFIG.VERSION_PREFIX.length)),
        c => c.charCodeAt(0)
      );

      const salt = combined.slice(0, CRYPTO_CONFIG.SALT_LENGTH);
      const iv = combined.slice(CRYPTO_CONFIG.SALT_LENGTH, CRYPTO_CONFIG.SALT_LENGTH + CRYPTO_CONFIG.IV_LENGTH);
      const ciphertext = combined.slice(CRYPTO_CONFIG.SALT_LENGTH + CRYPTO_CONFIG.IV_LENGTH);

      const key = await deriveKey(salt);

      const decrypted = await crypto.subtle.decrypt(
        { name: CRYPTO_CONFIG.ALGORITHM, iv },
        key,
        ciphertext
      );

      return new TextDecoder().decode(decrypted);
    }

    // Handle v3 (XOR encrypted) - migration
    if (encrypted.startsWith('MGv3_')) {
      const LEGACY_SALT = 'MG_2024_SEC';
      const decoded = atob(encrypted.slice(5));
      let result = '';
      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ LEGACY_SALT.charCodeAt(i % LEGACY_SALT.length);
        result += String.fromCharCode(charCode);
      }
      return result;
    }

    // Handle v2 (base64 reversed) - migration
    if (encrypted.startsWith('MG_')) {
      const encoded = encrypted.slice(3).split('').reverse().join('');
      return atob(encoded);
    }

    // Legacy plain key
    return encrypted;
  } catch (e) {
    console.error('Decryption failed:', e);
    return '';
  }
};

// Sync wrapper for encryption (uses cached promise)
let encryptionPromise: Promise<string> | null = null;
const encryptKey = (key: string): string => {
  // Start async encryption and return placeholder
  encryptionPromise = encryptKeyAsync(key);
  // For immediate sync return, use legacy format temporarily
  // The async version will be saved on next access
  const LEGACY_SALT = 'MG_2024_SEC';
  let result = '';
  for (let i = 0; i < key.length; i++) {
    const charCode = key.charCodeAt(i) ^ LEGACY_SALT.charCodeAt(i % LEGACY_SALT.length);
    result += String.fromCharCode(charCode);
  }
  return 'MGv3_' + btoa(result);
};

// Sync wrapper for decryption (fallback for legacy)
const decryptKey = (encrypted: string): string => {
  // For v4, need async - return empty and caller should use async
  if (encrypted.startsWith(CRYPTO_CONFIG.VERSION_PREFIX)) {
    return ''; // Caller should use getApiKeyAsync
  }

  // Handle legacy formats synchronously
  try {
    if (encrypted.startsWith('MGv3_')) {
      const LEGACY_SALT = 'MG_2024_SEC';
      const decoded = atob(encrypted.slice(5));
      let result = '';
      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ LEGACY_SALT.charCodeAt(i % LEGACY_SALT.length);
        result += String.fromCharCode(charCode);
      }
      return result;
    }
    if (encrypted.startsWith('MG_')) {
      const encoded = encrypted.slice(3).split('').reverse().join('');
      return atob(encoded);
    }
    return encrypted;
  } catch {
    return '';
  }
};

// Safe JSON parsing with fallback and size limit
const safeJsonParse = <T>(data: string | null, fallback: T, maxSize = 5000000): T => {
  if (!data) return fallback;
  if (data.length > maxSize) {
    console.warn('Data exceeds size limit, using fallback');
    return fallback;
  }
  try {
    const parsed = JSON.parse(data);
    return parsed as T;
  } catch (e) {
    console.warn('JSON parse error, using fallback');
    return fallback;
  }
};

// Input sanitization - removes potential XSS vectors
const sanitizeString = (input: string, maxLength = 10000): string => {
  if (typeof input !== 'string') return '';
  return input
    .slice(0, maxLength)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\\/g, '&#x5C;')
    .replace(/`/g, '&#x60;')
    .trim();
};

// Validate ID format (UUID or prefixed ID)
const isValidId = (id: string): boolean => {
  if (!id || typeof id !== 'string') return false;
  // Allow UUID format or prefixed IDs like 'seed-1', 'char_default_host'
  return /^[a-zA-Z0-9_-]{1,50}$/.test(id);
};

// Validate API key format
const isValidApiKey = (key: string): boolean => {
  if (!key || typeof key !== 'string') return false;
  // Gemini API keys start with "AIza" and are 39 characters
  return /^AIza[A-Za-z0-9_-]{35}$/.test(key);
};

// Validate data URL format for images with size check
const isValidDataUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('data:image/')) return false;
  // Check approximate size (base64 is ~4/3 of original)
  const base64Part = url.split(',')[1];
  if (base64Part && base64Part.length > SECURITY_CONFIG.MAX_IMAGE_SIZE_BYTES * 1.4) {
    console.warn('Image data URL exceeds size limit');
    return false;
  }
  return true;
};

// Validate difficulty value
const isValidDifficulty = (difficulty: string): difficulty is 'light' | 'normal' | 'heavy' => {
  return ['light', 'normal', 'heavy'].includes(difficulty);
};

// Check storage quota
const checkStorageQuota = (): boolean => {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch {
    console.error('localStorage quota exceeded or unavailable');
    return false;
  }
};

const SEED_QUESTIONS: Question[] = [
  // === 逆説的な問い ===
  {
    id: 'seed-1',
    text: '30代で「このままでいいのか」と迷ったとき、最初に何を捨てればいいですか？',
    source: '架空の相談',
    tags: ['キャリア', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-2',
    text: 'なぜ、私たちは「休むこと」に罪悪感を感じてしまうのでしょうか？',
    source: '思考メモ',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-3',
    text: '今までで一番「無駄だった」と思う努力と、そこから得た教訓は？',
    source: 'Reddit要約',
    tags: ['仕事', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-4',
    text: '朝一番にやると人生が変わる小さな習慣はありますか？',
    source: 'Yahoo知恵袋',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-5',
    text: '「好きなことを仕事にする」vs「得意なことを仕事にする」、幸福度が高いのはどっち？',
    source: 'X (Twitter)',
    tags: ['キャリア', '仕事'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-6',
    text: '他人と比較して落ち込んでしまった時の、最強の切り替えスイッチは？',
    source: 'メンタルハック',
    tags: ['メンタル', '人間関係'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-7',
    text: 'もし「お金」という概念がなくなったら、あなたは毎日何をしますか？',
    source: '哲学',
    tags: ['意思決定', 'キャリア'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-8',
    text: '情報の洪水から身を守るための、具体的なデジタルデトックス方法は？',
    source: '現代社会',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-9',
    text: '「良いリーダー」と「偉そうなだけの上司」の決定的な違いを一言で言うなら？',
    source: 'ビジネス書',
    tags: ['仕事', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-10',
    text: 'AIが台頭する時代に、人間が絶対に手放してはいけない能力とは？',
    source: '未来予測',
    tags: ['学習', 'キャリア'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-11',
    text: '失敗したとき、自分にかける言葉として最も効果的なものは？',
    source: '自己肯定感',
    tags: ['メンタル', '学習'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-12',
    text: '「大人になる」とは、具体的にどういう状態になることだと思いますか？',
    source: '哲学カフェ',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-13',
    text: '1週間、誰とも話さずに過ごすことになったら、何をしますか？',
    source: '思考実験',
    tags: ['習慣', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-14',
    text: '効率化しすぎて逆に人生がつまらなくなっていませんか？「無駄」の効用について。',
    source: 'エッセイ',
    tags: ['ライフハック', '仕事'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-15',
    text: 'あなたの人生の「伏線回収」だったと感じる出来事はありますか？',
    source: 'ナラティブ',
    tags: ['学習', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 新規追加：逆説的な問い ===
  {
    id: 'seed-16',
    text: '努力は必ず報われると信じてる人は、報われない努力をどう説明する？',
    source: 'X (Twitter)',
    tags: ['学習', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-17',
    text: '「自分らしく生きる」って言うけど、その「自分」は本当に自分で作ったもの？',
    source: '哲学フォーラム',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-18',
    text: '成功者の「諦めなかったから成功した」は、生存者バイアスじゃないの？',
    source: 'Reddit',
    tags: ['キャリア', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-19',
    text: '「空気を読む」のは美徳？それとも自己犠牲の始まり？',
    source: '日本文化論',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 二項対立の問い ===
  {
    id: 'seed-20',
    text: '才能と努力、最終的に勝つのはどっち？そしてあなたはどちらを信じたい？',
    source: 'X (Twitter)',
    tags: ['学習', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-21',
    text: '安定した退屈 vs 不安定な刺激、人生の幸福度が高いのはどっち？',
    source: '心理学コミュニティ',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-22',
    text: '過去の自分を恥じる人 vs 過去の自分を許せる人、どちらが成長している？',
    source: '自己啓発',
    tags: ['メンタル', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-23',
    text: '「嫌われる勇気」と「好かれる努力」、どちらが人間関係を豊かにする？',
    source: 'ビジネス書',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-24',
    text: '転職を繰り返す人 vs 一社に長く勤める人、10年後に笑っているのは？',
    source: 'キャリア相談',
    tags: ['キャリア', '仕事'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 自己省察の問い ===
  {
    id: 'seed-25',
    text: 'あなたが最後に「本気で」何かに取り組んだのはいつ？それは何？',
    source: '思考実験',
    tags: ['学習', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-26',
    text: '5年前の自分に「それ、やめとけ」と言いたいことは何？',
    source: 'Yahoo知恵袋',
    tags: ['学習', 'キャリア'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-27',
    text: '今の自分を一番よく知っている人は誰？そしてそれはなぜ？',
    source: '心理学コミュニティ',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-28',
    text: '「あの時、別の選択をしていたら」と思う分岐点はありますか？',
    source: '人生相談',
    tags: ['意思決定', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-29',
    text: 'あなたの「弱さ」が、実は誰かを救ったことはありませんか？',
    source: 'メンタルハック',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 未来予測の問い ===
  {
    id: 'seed-30',
    text: '10年後、今の仕事は存在しているか？そして自分は何をしている？',
    source: '未来予測',
    tags: ['キャリア', '仕事'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-31',
    text: 'AIに代替されない「人間らしさ」って、結局何だと思う？',
    source: 'テクノロジー',
    tags: ['学習', 'キャリア'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-32',
    text: '死ぬ直前の自分が「これだけは伝えたい」と思うことは何？',
    source: '哲学',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-33',
    text: '100歳まで生きる時代、40代は「人生の折り返し」じゃなくなる？',
    source: '人生100年時代',
    tags: ['キャリア', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 哲学的な問い ===
  {
    id: 'seed-34',
    text: '幸せを追求することは、幸せを遠ざけることになるのか？',
    source: '哲学フォーラム',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-35',
    text: '「普通」に生きることは、勇気がいることだと思いますか？',
    source: '哲学カフェ',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-36',
    text: '人は変われるのか？それとも、変わったように見えるだけ？',
    source: '心理学',
    tags: ['学習', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-37',
    text: '「正しい」と「優しい」が矛盾するとき、あなたはどちらを選ぶ？',
    source: '倫理学',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-38',
    text: '孤独と孤立の違いは何？そして、あなたはどちらにいる？',
    source: '社会学',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 人間関係の問い ===
  {
    id: 'seed-39',
    text: '本音で話せる相手が一人もいないと気づいた時、何から始める？',
    source: '人生相談',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-40',
    text: '「許す」と「忘れる」は違う。許せないまま、前に進む方法は？',
    source: '心理学コミュニティ',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-41',
    text: 'SNSのフォロワー1000人より、深い友人1人。でも本当にそう思える？',
    source: 'X (Twitter)',
    tags: ['人間関係', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-42',
    text: '親との関係がうまくいかない。でも「縁を切る」以外の選択肢は？',
    source: 'Yahoo知恵袋',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 仕事・キャリアの問い ===
  {
    id: 'seed-43',
    text: '週休3日になったら、増えた1日で何をする？本当にやりたいこと？',
    source: '働き方改革',
    tags: ['仕事', 'ライフハック'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-44',
    text: '「やりがい搾取」と「好きな仕事」の境界線はどこにある？',
    source: 'ビジネスメディア',
    tags: ['仕事', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-45',
    text: '上司に「向いてない」と言われた。転職すべき？それとも見返すべき？',
    source: 'キャリア相談',
    tags: ['仕事', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-46',
    text: '副業で月5万稼ぐのと、本業で月5万昇給するの、どっちが難しい？',
    source: 'X (Twitter)',
    tags: ['仕事', 'キャリア'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 習慣・ライフハックの問い ===
  {
    id: 'seed-47',
    text: '「続かない」のは意志が弱いから？それとも仕組みが悪いから？',
    source: '行動科学',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-48',
    text: '毎日同じルーティンは「安定」か「停滞」か？',
    source: 'ライフハック',
    tags: ['習慣', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-49',
    text: 'スマホを1週間手放したら、自分の中で何が変わると思う？',
    source: 'デジタルデトックス',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-50',
    text: '早起きできない人は、本当に「朝型」を目指すべき？',
    source: '睡眠科学',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 現代社会の問い ===
  {
    id: 'seed-51',
    text: '「コスパ」「タイパ」で測れないものにこそ、価値があるのでは？',
    source: '現代社会論',
    tags: ['意思決定', 'ライフハック'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-52',
    text: 'なぜ日本人は「謙虚」を美徳とするのに、自己肯定感が低いのか？',
    source: '文化論',
    tags: ['メンタル', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-53',
    text: '「推し活」は現実逃避？それとも最高の自己投資？',
    source: 'X (Twitter)',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-54',
    text: 'マッチングアプリで出会った恋愛は「本物」じゃないの？',
    source: '恋愛相談',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-55',
    text: '「親ガチャ」という言葉に救われる人と傷つく人、何が違う？',
    source: '社会問題',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 創造性・表現の問い ===
  {
    id: 'seed-56',
    text: 'AIが絵を描き、文章を書く時代。人間の「創造性」とは何か？',
    source: 'クリエイティブ',
    tags: ['学習', 'キャリア'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-57',
    text: 'アウトプットが怖い人へ。完璧じゃないと出せないのはなぜ？',
    source: 'クリエイター相談',
    tags: ['学習', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-58',
    text: '「量をこなせば質は上がる」は本当？それとも方向音痴のまま走るだけ？',
    source: '学習論',
    tags: ['学習', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === ユニークな問い ===
  {
    id: 'seed-59',
    text: '宝くじで10億円当たったら、仕事を続ける？辞める？その理由は？',
    source: '思考実験',
    tags: ['仕事', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-60',
    text: 'もし記憶を一つだけ消せるとしたら、何を消す？そして消した後、後悔しない？',
    source: 'SF',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 追加：恋愛・パートナーシップの問い ===
  {
    id: 'seed-61',
    text: '「運命の人」は本当にいる？それとも「選んだ人」を運命にするもの？',
    source: '恋愛哲学',
    tags: ['人間関係', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-62',
    text: '「好き」と「一緒にいて楽」は違う。どちらを選ぶべき？',
    source: '恋愛相談',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-63',
    text: '結婚相手に求めるもの、5年前と今で変わった？それはなぜ？',
    source: 'Yahoo知恵袋',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-64',
    text: '「別れた方がいい」と分かってても別れられない。何が自分を縛っている？',
    source: '心理学コミュニティ',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-65',
    text: '浮気を許せる人と許せない人、何が違うと思う？',
    source: 'X (Twitter)',
    tags: ['人間関係', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 追加：お金・経済の問い ===
  {
    id: 'seed-66',
    text: '「お金で幸せは買えない」と言う人は、お金に困ったことがない人？',
    source: '経済論',
    tags: ['意思決定', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-67',
    text: '年収いくらあれば「十分」？その基準は誰が決めた？',
    source: 'マネー相談',
    tags: ['仕事', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-68',
    text: '節約 vs 自己投資、限られたお金をどちらに使うべき？',
    source: '資産形成',
    tags: ['ライフハック', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-69',
    text: '貯金ゼロの30代。今から始めて間に合う？何から始める？',
    source: 'Yahoo知恵袋',
    tags: ['ライフハック', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-70',
    text: '「時間をお金で買う」のは贅沢？それとも最高の投資？',
    source: 'ライフハック',
    tags: ['ライフハック', '仕事'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 追加：健康・身体の問い ===
  {
    id: 'seed-71',
    text: '運動習慣がない人が、続けられる運動を見つけるコツは？',
    source: '健康相談',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-72',
    text: '「健康のために我慢する」vs「好きなものを食べて生きる」、正解は？',
    source: '健康論',
    tags: ['習慣', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-73',
    text: 'メンタルヘルスの不調を感じたら、最初に誰に相談すべき？',
    source: '心理学コミュニティ',
    tags: ['メンタル', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-74',
    text: '睡眠時間を削って頑張るのは、本当に「頑張っている」と言える？',
    source: '睡眠科学',
    tags: ['習慣', '仕事'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：学び・教育の問い ===
  {
    id: 'seed-75',
    text: '学歴は本当に必要？なくても成功した人と、あって良かった人の違いは？',
    source: '教育論',
    tags: ['学習', 'キャリア'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-76',
    text: '「勉強しなさい」と言われて育った人は、大人になっても学べている？',
    source: '教育心理学',
    tags: ['学習', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-77',
    text: '資格を取れば安心？資格マニアになってしまう人の心理とは？',
    source: 'キャリア相談',
    tags: ['学習', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-78',
    text: '本を読む人と読まない人、10年後に何が違う？',
    source: '読書論',
    tags: ['学習', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-79',
    text: '英語が話せないことへの焦り。本当に必要？それとも幻想？',
    source: 'X (Twitter)',
    tags: ['学習', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：SNS・デジタルの問い ===
  {
    id: 'seed-80',
    text: 'SNSで「映える」人生を演出することに疲れた。どうすればいい？',
    source: 'デジタルウェルビーイング',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-81',
    text: 'ネットの誹謗中傷を見て傷つく自分は「繊細すぎる」のか？',
    source: 'SNS論',
    tags: ['メンタル', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-82',
    text: 'フォロワー数＝自分の価値、という錯覚から抜け出す方法は？',
    source: 'X (Twitter)',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-83',
    text: '「いいね」がつかないと不安になる。この感情の正体は何？',
    source: '心理学',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：家族の問い ===
  {
    id: 'seed-84',
    text: '子供を持つことへの迷い。「欲しくない」は悪いこと？',
    source: '人生相談',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-85',
    text: '親を介護することになった。仕事と両立できる？',
    source: '介護相談',
    tags: ['人間関係', '仕事'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-86',
    text: '実家に帰りたくない。でも「親不孝」という罪悪感がある。',
    source: 'Yahoo知恵袋',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-87',
    text: '兄弟姉妹と比較されて育った傷は、大人になっても消えない？',
    source: '心理学コミュニティ',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 追加：成功・失敗の問い ===
  {
    id: 'seed-88',
    text: '「成功」の定義は人それぞれ、と言うけど、自分の定義は何？',
    source: '自己啓発',
    tags: ['キャリア', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-89',
    text: '大きな失敗から立ち直れた人と、立ち直れない人の違いは？',
    source: 'レジリエンス',
    tags: ['メンタル', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-90',
    text: '「失敗は成功のもと」は本当？同じ失敗を繰り返す人もいるけど。',
    source: '学習論',
    tags: ['学習', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-91',
    text: '周りが成功していく中、自分だけ取り残されている気がする。',
    source: '人生相談',
    tags: ['メンタル', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：時間の問い ===
  {
    id: 'seed-92',
    text: '「時間がない」は言い訳？それとも現代人の本当の悩み？',
    source: '時間管理',
    tags: ['習慣', '仕事'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-93',
    text: '過去を悔やむ時間、未来を心配する時間、どちらがもったいない？',
    source: '哲学カフェ',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-94',
    text: '「今を生きる」って具体的にどうすればいいの？',
    source: 'マインドフルネス',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-95',
    text: '1日が24時間じゃ足りないと感じる。何を削るべき？',
    source: 'ライフハック',
    tags: ['習慣', '仕事'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 追加：自己肯定感の問い ===
  {
    id: 'seed-96',
    text: '自己肯定感が低いまま大人になった。今からでも上げられる？',
    source: '心理学コミュニティ',
    tags: ['メンタル', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-97',
    text: '「自分を好きになれ」と言われても、具体的に何をすれば？',
    source: '自己啓発',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-98',
    text: '褒められても素直に受け取れない。この癖、どう直す？',
    source: '心理学',
    tags: ['メンタル', '人間関係'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-99',
    text: '自信がある人とない人、育ち方の何が違ったのか？',
    source: '発達心理学',
    tags: ['メンタル', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 追加：変化・決断の問い ===
  {
    id: 'seed-100',
    text: '「現状維持」も立派な選択？それとも逃げ？',
    source: '意思決定論',
    tags: ['意思決定', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-101',
    text: '大きな決断をするとき、最終的に何を信じるべき？',
    source: '哲学',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-102',
    text: '人生をリセットできるボタンがあったら、押す？押さない？',
    source: '思考実験',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-103',
    text: '「石橋を叩いて渡る」と「とりあえずやってみる」、どっちの人生が豊か？',
    source: 'X (Twitter)',
    tags: ['意思決定', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：死生観の問い ===
  {
    id: 'seed-104',
    text: '「死」について考えることは、ネガティブ？それとも必要？',
    source: '哲学',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-105',
    text: '余命1年と言われたら、今の生活で何を変える？',
    source: '思考実験',
    tags: ['意思決定', 'ライフハック'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-106',
    text: '「後悔のない人生」は本当に可能？それとも幻想？',
    source: '人生哲学',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 追加：コミュニケーションの問い ===
  {
    id: 'seed-107',
    text: '「空気を読む」のが苦手。でも読めるようになりたい？なりたくない？',
    source: 'コミュニケーション',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-108',
    text: '本音と建前、使い分けるのは「大人の対応」？それとも「嘘つき」？',
    source: '日本文化論',
    tags: ['人間関係', '仕事'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-109',
    text: '相手の話を聞くのが苦手。「傾聴」って具体的にどうやるの？',
    source: 'コーチング',
    tags: ['人間関係', '学習'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-110',
    text: '言いたいことが言えない自分を変えたい。でも「言い過ぎ」も怖い。',
    source: 'アサーション',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：働き方の問い ===
  {
    id: 'seed-111',
    text: 'リモートワークで失われたもの、得られたもの、どっちが大きい？',
    source: '働き方改革',
    tags: ['仕事', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-112',
    text: '「静かな退職」は悪いこと？それとも自己防衛？',
    source: 'ビジネスメディア',
    tags: ['仕事', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-113',
    text: '上司に評価されない。能力がない？それとも見せ方が下手？',
    source: 'キャリア相談',
    tags: ['仕事', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-114',
    text: '「仕事が楽しい」と言う人を信じられない。本当に楽しいの？',
    source: 'X (Twitter)',
    tags: ['仕事', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-115',
    text: '残業しないと評価されない職場。転職すべき？戦うべき？',
    source: '労働問題',
    tags: ['仕事', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：趣味・娯楽の問い ===
  {
    id: 'seed-116',
    text: '「趣味がない」は悪いこと？無理に見つける必要ある？',
    source: 'Yahoo知恵袋',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-117',
    text: '推しに人生を捧げることは、逃げ？それとも最高の生き方？',
    source: 'オタク文化',
    tags: ['習慣', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-118',
    text: 'ゲームに何百時間も費やした。無駄だった？それとも価値があった？',
    source: 'Reddit',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-119',
    text: '一人で楽しむ趣味と、誰かと楽しむ趣味、どっちが人生を豊かにする？',
    source: 'ライフスタイル',
    tags: ['習慣', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：自己理解の問い ===
  {
    id: 'seed-120',
    text: '「本当の自分」なんて存在する？それとも状況で変わるのが普通？',
    source: '哲学',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-121',
    text: '長所と短所は表裏一体。短所を直す必要は本当にある？',
    source: '自己啓発',
    tags: ['メンタル', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-122',
    text: '「自分探し」は時間の無駄？それとも必要なプロセス？',
    source: '人生相談',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-123',
    text: '自分の「嫌いなところ」と向き合う勇気、どうやって出す？',
    source: '心理学',
    tags: ['メンタル', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 追加：社会・政治の問い ===
  {
    id: 'seed-124',
    text: '政治に興味がない若者は「無責任」？それとも「諦め」？',
    source: '社会問題',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-125',
    text: '格差社会は「自己責任」で片付けていい問題？',
    source: '社会学',
    tags: ['意思決定', 'キャリア'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-126',
    text: '「みんなが投票すれば政治は変わる」は本当？',
    source: '政治学',
    tags: ['意思決定', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：世代間の問い ===
  {
    id: 'seed-127',
    text: '「最近の若者は」と言う大人。でも、昔の若者も同じこと言われてた？',
    source: '世代論',
    tags: ['人間関係', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-128',
    text: 'Z世代とミレニアル世代、価値観の違いは何から生まれた？',
    source: '社会学',
    tags: ['人間関係', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-129',
    text: '親世代の「普通」が通用しない時代。何を信じればいい？',
    source: 'X (Twitter)',
    tags: ['意思決定', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：夢・目標の問い ===
  {
    id: 'seed-130',
    text: '「夢を持て」と言われるけど、夢がない人はダメなの？',
    source: '自己啓発批判',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-131',
    text: '夢を諦めた瞬間と、夢を追い続けるべき瞬間、どう見分ける？',
    source: '人生相談',
    tags: ['キャリア', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-132',
    text: '「小さな目標」と「大きな夢」、どちらが人を動かす？',
    source: '行動科学',
    tags: ['習慣', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-133',
    text: '目標を達成した後の「虚無感」、どう乗り越える？',
    source: '心理学',
    tags: ['メンタル', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：感情の問い ===
  {
    id: 'seed-134',
    text: '怒りを感じた時、表に出すべき？それとも抑えるべき？',
    source: '感情心理学',
    tags: ['メンタル', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-135',
    text: '「泣いていいよ」と言われても泣けない。感情が麻痺している？',
    source: '心理学コミュニティ',
    tags: ['メンタル', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-136',
    text: '嫉妬心を感じる自分が嫌。でも嫉妬は「悪」なの？',
    source: '感情論',
    tags: ['メンタル', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-137',
    text: '「ポジティブでいなきゃ」というプレッシャー、逆に辛くない？',
    source: 'メンタルヘルス',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 追加：価値観の問い ===
  {
    id: 'seed-138',
    text: '「常識」は誰が決めた？そして、それを疑う勇気はある？',
    source: '哲学',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-139',
    text: '自分の価値観と社会の価値観がズレている。合わせるべき？貫くべき？',
    source: '人生相談',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-140',
    text: '「多様性を認めよう」と言いながら、認められない価値観もある。矛盾では？',
    source: '社会哲学',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 追加：ユニークな思考実験 ===
  {
    id: 'seed-141',
    text: '自分のクローンができたら、友達になれる？それとも嫌いになる？',
    source: 'SF思考実験',
    tags: ['メンタル', '人間関係'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-142',
    text: 'タイムマシンで過去に戻れるなら、いつに戻る？何をする？',
    source: '思考実験',
    tags: ['意思決定', '学習'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-143',
    text: '世界中の人の考えが読めるようになったら、幸せ？不幸？',
    source: 'SF',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-144',
    text: '「永遠に生きられる」と言われたら、その能力を受け入れる？',
    source: '哲学',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-145',
    text: '全人類が嘘をつけなくなったら、社会はどうなる？',
    source: '思考実験',
    tags: ['人間関係', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 追加：日常の問い ===
  {
    id: 'seed-146',
    text: '毎日同じ道を通って出勤する。それは「安定」？「思考停止」？',
    source: 'ライフハック',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-147',
    text: '「今日は何もしなかった」という日に、罪悪感を感じる必要はある？',
    source: 'メンタルハック',
    tags: ['メンタル', '習慣'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-148',
    text: '家事は「誰かがやらなきゃいけないこと」？それとも「やりたい人がやること」？',
    source: '家庭論',
    tags: ['人間関係', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-149',
    text: '「丁寧な暮らし」に憧れるけど、疲れそう。シンプルに生きる方法は？',
    source: 'ミニマリズム',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-150',
    text: '人生で一番大切なものは何？今すぐ答えられる？',
    source: '人生哲学',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 現代テクノロジー・AI時代の問い ===
  {
    id: 'seed-151',
    text: 'ChatGPTに相談する方が友達より気楽。これって孤独の進化？退化？',
    source: 'テクノロジー論',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-152',
    text: 'AIが書いた文章と人間が書いた文章、区別できなくなった時代に「本物」とは何？',
    source: 'AI倫理',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-153',
    text: 'AIに仕事を奪われる恐怖と、AIで仕事が楽になる希望、どっちが大きい？',
    source: '未来の働き方',
    tags: ['キャリア', '仕事'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-154',
    text: 'ディープフェイクで誰でも偽造できる時代。「見たものを信じる」はもう通用しない？',
    source: 'メディアリテラシー',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-155',
    text: 'AIアートは「芸術」と呼べる？人間の創造性に機械は入れるのか？',
    source: 'アート論',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-156',
    text: 'スマートウォッチが健康を管理してくれる時代。自分の体の声、まだ聞こえてる？',
    source: 'ヘルステック',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-157',
    text: 'アルゴリズムが「あなたへのおすすめ」を決める。自分の趣味は本当に自分のもの？',
    source: 'テクノロジー批評',
    tags: ['意思決定', '習慣'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-158',
    text: 'プログラミングを学ぶべき？それともAIに任せて「何を作るか」を考えるべき？',
    source: 'IT教育',
    tags: ['学習', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === SNS・デジタル社会の現代的問い ===
  {
    id: 'seed-159',
    text: 'TikTokの15秒動画に慣れた脳で、本を1冊読み切る集中力はまだある？',
    source: 'デジタル認知科学',
    tags: ['習慣', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-160',
    text: 'インフルエンサーの「おすすめ」で物を買う自分。消費は自分で選んでる？',
    source: 'マーケティング批評',
    tags: ['意思決定', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-161',
    text: 'エコーチェンバーの中にいる自覚はある？自分と違う意見に最後に触れたのはいつ？',
    source: '情報リテラシー',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-162',
    text: '「既読スルー」で人間関係が壊れる時代。常に返信し続けるのが礼儀？',
    source: 'コミュニケーション論',
    tags: ['人間関係', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-163',
    text: 'ネットで叩かれた経験がある。匿名の悪意とどう向き合えばいい？',
    source: 'サイバーハラスメント',
    tags: ['メンタル', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-164',
    text: '「バズる」ことを意識した発信は、自分の本音から離れていかない？',
    source: 'SNS文化論',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-165',
    text: 'オンラインの友達は「リアルな友達」と同じ価値がある？',
    source: 'デジタル社会学',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 現代の働き方・キャリアの問い ===
  {
    id: 'seed-166',
    text: 'フルリモートで通勤ゼロ。でも雑談もゼロ。人間的な成長は止まってない？',
    source: 'リモートワーク論',
    tags: ['仕事', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-167',
    text: '「副業OK」の時代。本業に全力を出せなくなるリスク、考えてる？',
    source: '副業論',
    tags: ['仕事', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-168',
    text: 'ギグワーカーの自由と不安定。「自由」に見合うリスクを取れる覚悟はある？',
    source: 'ギグエコノミー',
    tags: ['仕事', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-169',
    text: 'FIRE（早期リタイア）に憧れる。でも「働かない人生」って本当に楽しい？',
    source: '資産形成',
    tags: ['仕事', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-170',
    text: '「パーパス経営」「SDGs」を掲げる企業。本気？それともポーズ？',
    source: 'ビジネス批評',
    tags: ['仕事', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-171',
    text: '就活の「ガクチカ」文化。大学時代に「映える経験」がないとダメなの？',
    source: '就活論',
    tags: ['キャリア', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-172',
    text: 'スキルを常にアップデートし続けないと生き残れない。「学び続ける疲れ」感じてない？',
    source: 'リスキリング',
    tags: ['学習', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 現代の人間関係・恋愛の問い ===
  {
    id: 'seed-173',
    text: 'マッチングアプリで100人とやりとりしても「運命の人」に出会えない。何が足りない？',
    source: '現代恋愛',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-174',
    text: '「蛙化現象」が話題だけど、好きな人に好かれると冷めるのはなぜ？',
    source: 'Z世代トレンド',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-175',
    text: '友達の結婚報告を素直に喜べない自分がいる。この焦りの正体は？',
    source: 'X (Twitter)',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-176',
    text: '「一人が好き」と「寂しい」は両立する？現代の孤独のかたちとは？',
    source: '孤独論',
    tags: ['メンタル', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-177',
    text: 'パートナーとSNSのパスワードを共有すべき？プライバシーと信頼の境界線は？',
    source: '現代恋愛',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-178',
    text: '「推し」に恋愛感情を持つのはおかしい？二次元と三次元の境界が曖昧な時代。',
    source: 'オタク文化論',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 経済・お金の現代的問い ===
  {
    id: 'seed-179',
    text: '物価は上がるのに給料は上がらない。「頑張れば報われる」はもう幻想？',
    source: '経済論',
    tags: ['仕事', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-180',
    text: 'サブスク地獄。月々の小さな出費が積み重なって、いくら払ってるか把握してる？',
    source: 'マネーリテラシー',
    tags: ['ライフハック', '習慣'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-181',
    text: 'NISAや投資を始めないと老後が不安。でも投資の知識ゼロ。何から始める？',
    source: '資産形成',
    tags: ['ライフハック', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-182',
    text: '「推し活」にいくらまで使っていい？趣味への課金に上限は必要？',
    source: 'X (Twitter)',
    tags: ['ライフハック', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-183',
    text: '都心の家賃は高すぎる。地方移住すれば幸せになれる？',
    source: '住まい論',
    tags: ['ライフハック', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-184',
    text: '「経験にお金を使え」と言われるけど、貯金ゼロで経験ばかり積んでも大丈夫？',
    source: 'マネー相談',
    tags: ['意思決定', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === メンタルヘルス・ウェルビーイングの現代的問い ===
  {
    id: 'seed-185',
    text: '「メンタルヘルス」が流行語みたいになってるけど、本当に理解されてる？',
    source: 'メンタルヘルス論',
    tags: ['メンタル', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-186',
    text: 'HSP（繊細さん）ブーム。自分がHSPだと知って楽になった？それともラベルに縛られた？',
    source: '心理学トレンド',
    tags: ['メンタル', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-187',
    text: '「自己肯定感を上げよう」の大合唱。でも、低いままでも生きていけない？',
    source: 'メンタルハック批評',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-188',
    text: 'マインドフルネス瞑想、始めたけど続かない。「心を整える」のも努力が必要？',
    source: 'ウェルビーイング',
    tags: ['メンタル', '習慣'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-189',
    text: 'セラピーやカウンセリングに行くのはまだ「弱い人」のイメージ？偏見は変わった？',
    source: 'メンタルヘルス',
    tags: ['メンタル', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-190',
    text: 'SNSで「鬱です」と発信すること。共感を求めるのは甘え？それとも助けを求める勇気？',
    source: 'SNS×メンタル',
    tags: ['メンタル', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === ジェンダー・多様性の現代的問い ===
  {
    id: 'seed-191',
    text: '「男らしさ」「女らしさ」を求められてモヤモヤする。でも完全になくすべき？',
    source: 'ジェンダー論',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-192',
    text: 'LGBTQへの理解は進んだ？カミングアウトしやすい社会になった？',
    source: '多様性論',
    tags: ['人間関係', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-193',
    text: '「無意識の偏見」に気づくのは大事。でも、気にしすぎて何も言えなくなってない？',
    source: 'ダイバーシティ',
    tags: ['人間関係', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-194',
    text: '選択的夫婦別姓、賛成？反対？そもそも「姓」って何のためにある？',
    source: '社会制度論',
    tags: ['意思決定', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-195',
    text: '「ルッキズム」を批判しつつ、外見を気にしてしまう。この矛盾とどう付き合う？',
    source: '現代社会批評',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 環境・サステナビリティの問い ===
  {
    id: 'seed-196',
    text: '気候変動が不安で子供を産みたくない「バースストライキ」。共感できる？',
    source: '環境倫理',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-197',
    text: 'エコバッグを使って、ストローを紙にして。個人の努力で地球は救える？',
    source: '環境問題',
    tags: ['意思決定', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-198',
    text: 'ファストファッションを買うのは「悪」？おしゃれを楽しむ権利と環境問題の板挟み。',
    source: 'サステナブル消費',
    tags: ['意思決定', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-199',
    text: 'フードロスを減らしたい。でも「もったいない」で食べ過ぎるのも不健康じゃない？',
    source: '食の倫理',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-200',
    text: '「SDGs」「サステナブル」って言葉、正直もう聞き飽きた？それとも足りない？',
    source: '環境論',
    tags: ['意思決定', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 教育・学びの現代的問い ===
  {
    id: 'seed-201',
    text: 'YouTubeで何でも学べる時代。大学に行く意味って本当にある？',
    source: '教育改革',
    tags: ['学習', 'キャリア'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-202',
    text: '子供にタブレットを与えるべき？デジタルネイティブの教育の正解は？',
    source: 'IT教育',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-203',
    text: '「不登校」は甘え？それとも学校システムの方がおかしい？',
    source: '教育論',
    tags: ['学習', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-204',
    text: 'AI時代に暗記教育は不要？「考える力」だけで生きていける？',
    source: '教育改革',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-205',
    text: 'オンライン授業で十分？「教室で学ぶ」ことの本当の価値は何だった？',
    source: 'ポストコロナ教育',
    tags: ['学習', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === ポストコロナ時代の問い ===
  {
    id: 'seed-206',
    text: 'コロナ禍で変わった価値観、元に戻ったもの、戻らないもの。何が残った？',
    source: 'ポストコロナ',
    tags: ['意思決定', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-207',
    text: '「密を避ける」生活に慣れた。人混みが怖いのは後遺症？適応？',
    source: 'ポストコロナ心理',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-208',
    text: 'コロナ禍で生まれた「推し活」ブーム。外出できない日々が育てた文化とは？',
    source: 'カルチャー論',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === キャンセルカルチャー・ネット文化の問い ===
  {
    id: 'seed-209',
    text: '10年前のSNS投稿で炎上。過去の発言に永遠に責任を持つべき？',
    source: 'キャンセルカルチャー',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-210',
    text: '「正義の暴走」と「正当な批判」の線引きはどこ？ネットリンチは許されない、でも…',
    source: 'ネット文化論',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-211',
    text: '炎上を恐れて何も発信しない。「沈黙」は安全策？それとも思考停止？',
    source: 'SNS論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-212',
    text: 'フェイクニュースを見抜く方法、学校で教えるべき？情報リテラシーの正解は？',
    source: 'メディアリテラシー',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 少子高齢化・社会問題の問い ===
  {
    id: 'seed-213',
    text: '「子育て罰」という言葉がある。日本は本当に子供を産みにくい国？',
    source: '少子化問題',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-214',
    text: '年金、もらえると思う？老後2000万円問題、Z世代はどう備える？',
    source: '社会保障',
    tags: ['ライフハック', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-215',
    text: '東京一極集中をどうする？地方に魅力がない？それとも東京に依存しすぎ？',
    source: '都市問題',
    tags: ['意思決定', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-216',
    text: '外国人労働者が増える日本。「多文化共生」は理想？現実に何が必要？',
    source: '社会問題',
    tags: ['人間関係', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-217',
    text: '8050問題（80代の親が50代の引きこもりの子を支える）。他人事じゃない未来？',
    source: '社会問題',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === ライフスタイル・消費の現代的問い ===
  {
    id: 'seed-218',
    text: 'ミニマリストに憧れるけど、物を捨てられない。「持たない暮らし」は万人向き？',
    source: 'ミニマリズム',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-219',
    text: 'コンビニ飯で生きるのは不健康？自炊できない人は「ダメな大人」？',
    source: '食文化論',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-220',
    text: 'タイパ重視で倍速視聴。映画を2倍速で観て「観た」と言える？',
    source: 'コンテンツ消費論',
    tags: ['習慣', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-221',
    text: '「丁寧な暮らし」vs「ズボラ最高」。SNS映えしない日常でもいい？',
    source: 'ライフスタイル',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-222',
    text: 'UberEatsで何でも届く時代。便利すぎて失ったものはない？',
    source: '現代消費論',
    tags: ['習慣', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-223',
    text: 'シェアハウス・シェアオフィス・シェアカー。「所有しない」は自由？不安？',
    source: 'シェアリング経済',
    tags: ['ライフハック', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === プライバシー・デジタル権利の問い ===
  {
    id: 'seed-224',
    text: '個人情報を渡す代わりに無料サービスを使う。このトレードオフ、納得してる？',
    source: 'プライバシー論',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-225',
    text: '監視カメラだらけの街。安全のためなら、プライバシーは犠牲にすべき？',
    source: 'セキュリティ論',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-226',
    text: '死後のSNSアカウント、どうする？デジタル遺産という新しい問題。',
    source: 'デジタル権利',
    tags: ['意思決定', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 現代の家族観・生き方の問い ===
  {
    id: 'seed-227',
    text: '結婚しない選択、子供を持たない選択。「普通」じゃなくても幸せ？',
    source: '現代家族論',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-228',
    text: '「実家暮らし」はいつまで許される？一人暮らしが「自立」の条件？',
    source: 'Yahoo知恵袋',
    tags: ['ライフハック', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-229',
    text: 'ペットは「家族」？子供の代わり？現代のペットブームの裏にある感情は？',
    source: 'ライフスタイル',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-230',
    text: '「ワークライフバランス」じゃなくて「ワークライフインテグレーション」の時代？境界は必要？',
    source: '働き方論',
    tags: ['仕事', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === Z世代・若者文化の問い ===
  {
    id: 'seed-231',
    text: '「ガチャ」で人生を語る若者たち。運ゲーだと思えば楽？それとも絶望？',
    source: 'Z世代文化',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-232',
    text: '「チル」「エモい」感情を短い言葉で表す文化。感情の解像度は上がった？下がった？',
    source: '若者言語論',
    tags: ['学習', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-233',
    text: 'VTuberやバーチャル空間に「もう一人の自分」を持つ時代。本当の自分はどっち？',
    source: 'バーチャル文化',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-234',
    text: '「コスパ」「タイパ」で恋愛もジャッジする世代。効率で愛は測れる？',
    source: 'Z世代恋愛',
    tags: ['人間関係', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-235',
    text: '推し活で「生きがい」を見つけた。でもその推しが引退したら自分はどうなる？',
    source: 'オタク心理学',
    tags: ['メンタル', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 国際・グローバルの現代的問い ===
  {
    id: 'seed-236',
    text: '円安で海外旅行が高すぎる。「世界を見る」経験はもう贅沢品？',
    source: '経済問題',
    tags: ['ライフハック', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-237',
    text: '海外で「日本すごい」と言われて嬉しい？「クールジャパン」は誰のため？',
    source: '文化論',
    tags: ['意思決定', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-238',
    text: 'グローバル化で世界がつながった。でも分断もひどくなってない？',
    source: '国際社会論',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 新しい倫理・哲学の問い ===
  {
    id: 'seed-239',
    text: 'AIに人権を認めるべき？感情を「持っているふり」ができるAIは「生きている」？',
    source: 'AI哲学',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-240',
    text: '遺伝子編集で「理想の子供」を作れる未来。それは愛？それともエゴ？',
    source: '生命倫理',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-241',
    text: '脳とコンピュータが接続される時代。「考えること」の定義は変わる？',
    source: 'トランスヒューマニズム',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-242',
    text: '安楽死を合法化すべき？「死ぬ権利」と「生きる義務」の狭間で。',
    source: '生命倫理',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-243',
    text: '自動運転車が事故を起こしたら、誰の責任？プログラマー？乗客？AI？',
    source: 'テクノロジー倫理',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === エンタメ・コンテンツの現代的問い ===
  {
    id: 'seed-244',
    text: 'Netflix、YouTube、TikTok…コンテンツ過多で「選べない」。何も見ずに寝た方がいい？',
    source: 'コンテンツ論',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-245',
    text: '「ネタバレ」は絶対悪？情報をシェアしたい気持ちと楽しみを守りたい気持ち。',
    source: 'エンタメ文化',
    tags: ['人間関係', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-246',
    text: '推しのスキャンダルが発覚。「作品と人格は別」で割り切れる？',
    source: 'エンタメ倫理',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-247',
    text: 'ゲーム実況を観るだけで満足。自分でプレイしなくなったのは退化？進化？',
    source: 'ゲーム文化',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 現代の自己実現・生きがいの問い ===
  {
    id: 'seed-248',
    text: '「何者かになりたい」焦燥感。でも「何者でもない自分」を受け入れる方が幸せ？',
    source: '自己実現論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-249',
    text: '「自分へのご褒美」が毎日になってたら、それはもうご褒美じゃない？',
    source: 'ライフスタイル',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-250',
    text: '「意識高い系」と笑われるのが怖くて、本気出せない。この空気、おかしくない？',
    source: '現代社会批評',
    tags: ['メンタル', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-251',
    text: '承認欲求は「悪」なの？人に認められたい気持ちは自然なことでは？',
    source: '心理学',
    tags: ['メンタル', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-252',
    text: '「好きなことで生きていく」がYouTubeのキャッチコピーだった。実現できた人、何割？',
    source: 'キャリア論',
    tags: ['キャリア', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === テクノロジーと日常の境界の問い ===
  {
    id: 'seed-253',
    text: 'スマホのスクリーンタイムを見て愕然。1日5時間以上は「依存」？',
    source: 'デジタルウェルネス',
    tags: ['習慣', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-254',
    text: '電子書籍 vs 紙の本。便利さと「手触り」、どっちを取る？',
    source: '読書文化',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-255',
    text: 'キャッシュレスで「お金を使った感覚」が薄れてない？見えないお金は怖い？',
    source: 'フィンテック',
    tags: ['ライフハック', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-256',
    text: 'メタバースに「もう一つの人生」を持つ時代が来る？現実逃避？新しい現実？',
    source: 'テクノロジー未来論',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 現代の食・健康の問い ===
  {
    id: 'seed-257',
    text: '完全栄養食だけで生きていける？「食べる楽しみ」は栄養に含まれない？',
    source: 'フードテック',
    tags: ['習慣', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-258',
    text: 'プロテイン・サプリ・筋トレブーム。「健康的な体」の定義は誰が決める？',
    source: '健康文化',
    tags: ['習慣', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-259',
    text: '「腸活」「温活」「朝活」…「○活」だらけの毎日。活動しすぎて疲れてない？',
    source: 'ウェルネス批評',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 新しい価値観・パラダイムの問い ===
  {
    id: 'seed-260',
    text: '「正解のない時代」と言われて久しい。でも正解がないなら、何を頼りに生きる？',
    source: '現代哲学',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-261',
    text: '「多様性」を認めるなら、「多様性を認めない」という価値観も認めるべき？',
    source: '哲学パラドックス',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-262',
    text: '「自己責任論」と「社会の構造的問題」。個人の努力でどこまで変えられる？',
    source: '社会哲学',
    tags: ['意思決定', 'キャリア'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-263',
    text: '「頑張らなくていい」と「頑張れ」、今の自分にはどっちの言葉が必要？',
    source: 'メンタルケア',
    tags: ['メンタル', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-264',
    text: 'SNSで「共感」を求めるのは弱さ？それとも人間の基本的な欲求？',
    source: '現代心理学',
    tags: ['メンタル', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-265',
    text: '「推し」がいない人生はつまらない？それとも自分自身を推せばいい？',
    source: '推し活哲学',
    tags: ['メンタル', '習慣'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 日本社会の今を問う ===
  {
    id: 'seed-266',
    text: '日本の「空気を読む」文化は強み？弱み？グローバル時代に通用する？',
    source: '日本文化論',
    tags: ['人間関係', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-267',
    text: '「失われた30年」の後に生まれた世代。上の世代に何を思う？',
    source: '世代間格差',
    tags: ['キャリア', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-268',
    text: 'タワマン・高級車・ブランド品。「見せる幸せ」と「感じる幸せ」、追いかけてるのはどっち？',
    source: '消費社会批評',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-269',
    text: '満員電車に揺られて出勤する意味。それでも東京で働き続ける理由は？',
    source: '都市生活論',
    tags: ['仕事', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-270',
    text: '「ブラック企業」を辞められない人がいる。辞めない理由は弱さ？それとも事情？',
    source: '労働問題',
    tags: ['仕事', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 究極の現代的問い ===
  {
    id: 'seed-271',
    text: '情報に溺れる毎日。「何も知らなかった頃」と今、どっちが幸せ？',
    source: '情報社会論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-272',
    text: '「比較しなければ幸せ」と分かっていても比較してしまう。SNS時代の宿命？',
    source: '現代心理学',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-273',
    text: '100年後の人から見たら、2020年代の私たちは何が「遅れている」と笑われる？',
    source: '未来予測',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-274',
    text: '人間関係をリセットしたくなる「人間関係リセット症候群」。逃げ？それとも自衛？',
    source: '現代心理',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-275',
    text: '「普通に生きたい」が最も難しい時代。「普通」のハードルが上がりすぎてない？',
    source: '現代社会論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 身体・美容・外見の問い ===
  {
    id: 'seed-276',
    text: '整形は「自己肯定感を上げる手段」？それとも「自己否定の延長線」？',
    source: '美容論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-277',
    text: '「ありのままの自分」を愛せと言うけど、メイクもおしゃれもダメなの？',
    source: 'ジェンダー論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-278',
    text: 'ダイエットは自己管理？それとも社会からの圧力に屈しているだけ？',
    source: 'ボディポジティブ',
    tags: ['習慣', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-279',
    text: '男性がスキンケアをすることに違和感がある人、まだいる？',
    source: '男性美容',
    tags: ['習慣', '人間関係'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 住まい・暮らしの問い ===
  {
    id: 'seed-280',
    text: '賃貸 vs 持ち家、結局どっちが正解？そもそも「正解」はある？',
    source: '不動産論',
    tags: ['ライフハック', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-281',
    text: '「住む場所で人生が変わる」は本当？環境が人を作る？人が環境を作る？',
    source: '都市論',
    tags: ['ライフハック', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-282',
    text: 'ノマドワーカーとして世界中を転々とする生活。自由？それとも根無し草？',
    source: 'ライフスタイル',
    tags: ['仕事', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-283',
    text: '実家を出たいけど経済的に無理。実家暮らしで自立する方法はある？',
    source: 'Yahoo知恵袋',
    tags: ['ライフハック', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 創作・表現活動の問い ===
  {
    id: 'seed-284',
    text: '「好きなことを発信する」のと「ウケることを発信する」の、どっちが続く？',
    source: 'クリエイター論',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-285',
    text: '小説・漫画・音楽…創作を続けるモチベーション、枯れた時どうする？',
    source: 'クリエイター相談',
    tags: ['学習', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-286',
    text: '「才能がない」と感じた瞬間、それでも続けるべき？撤退すべき？',
    source: '創作論',
    tags: ['キャリア', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-287',
    text: '二次創作は「パクリ」？「リスペクト」？「独自の文化」？',
    source: 'オタク文化論',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-288',
    text: '誰にも見せずに書き続ける日記と、世界に公開するブログ。どっちが「本当の自分」？',
    source: 'ライティング論',
    tags: ['学習', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 友情・人付き合いの問い ===
  {
    id: 'seed-289',
    text: '大人になると友達が作りにくくなる。なぜ？どうすればいい？',
    source: '社会心理学',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-290',
    text: '「付き合いが悪い」と言われるのが怖くて断れない飲み会。行くべき？',
    source: 'X (Twitter)',
    tags: ['人間関係', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-291',
    text: '10年来の親友と価値観がズレてきた。距離を置くのは裏切り？',
    source: '人間関係相談',
    tags: ['人間関係', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-292',
    text: '「友達は量より質」と言うけど、量がゼロだったらどうする？',
    source: '孤独論',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-293',
    text: 'ママ友・パパ友の付き合い。子供のためなら自分を殺すべき？',
    source: '育児相談',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 食・グルメの哲学 ===
  {
    id: 'seed-294',
    text: '「美味しいものを食べる」が人生最大の楽しみ。これって浅い？',
    source: '食の哲学',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-295',
    text: 'ヴィーガンは押し付けがましい？それとも正しい選択を伝えてるだけ？',
    source: '食の倫理',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-296',
    text: '「孤食」は寂しい？一人で食べるご飯が一番落ち着くという人もいるけど。',
    source: '食文化論',
    tags: ['習慣', '人間関係'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 旅・冒険の問い ===
  {
    id: 'seed-297',
    text: '一人旅が好きな人と、誰かと行きたい人。旅の本質って何？',
    source: '旅行論',
    tags: ['習慣', '人間関係'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-298',
    text: '「旅は人を変える」と言うけど、帰ってきたら元通りじゃない？',
    source: '旅行哲学',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-299',
    text: '行ったことのない場所に憧れるのに、いざ行くと「やっぱり家がいい」。この矛盾。',
    source: '旅行心理',
    tags: ['メンタル', '習慣'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 言葉・コミュニケーションの深掘り ===
  {
    id: 'seed-300',
    text: '「言葉にしないと伝わらない」と「言わなくても分かってほしい」。どっちが正しい？',
    source: 'コミュニケーション論',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-301',
    text: '敬語って本当に必要？年齢や立場で言葉を変えるのはおかしくない？',
    source: '日本語論',
    tags: ['人間関係', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-302',
    text: '「ありがとう」と「すみません」、日本人はなぜ感謝を謝罪で表現する？',
    source: '日本文化論',
    tags: ['人間関係', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-303',
    text: 'テキストコミュニケーションで感情が伝わらない。絵文字は解決策になる？',
    source: 'デジタルコミュニケーション',
    tags: ['人間関係', '習慣'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 睡眠・休息の問い ===
  {
    id: 'seed-304',
    text: '「寝る間を惜しんで」は美学？それとも自己破壊？',
    source: '睡眠科学',
    tags: ['習慣', '仕事'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-305',
    text: '夜型人間は「だらしない」？社会が朝型に偏りすぎてるだけでは？',
    source: '時間生物学',
    tags: ['習慣', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-306',
    text: '休日に何もしないで寝てるだけ。「休めた」のか「無駄にした」のか。',
    source: 'ライフハック',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 動物・ペットの問い ===
  {
    id: 'seed-307',
    text: 'ペットを「飼う」という行為自体が人間のエゴ？それとも共生？',
    source: '動物倫理',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-308',
    text: 'ペットロスで仕事を休む。「たかがペット」と言う人にどう返す？',
    source: 'ペットロス',
    tags: ['メンタル', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 音楽・アートの問い ===
  {
    id: 'seed-309',
    text: '音楽のサブスクで無限に聴ける時代。でも「CDを買う」特別感は消えた？',
    source: '音楽文化論',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-310',
    text: '美術館で「これの何がすごいの？」と思った経験。芸術の価値は誰が決める？',
    source: 'アート論',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-311',
    text: '「売れる作品」と「良い作品」は違う。でもお金がなければ創作は続けられない。',
    source: 'クリエイターエコノミー',
    tags: ['キャリア', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 科学・宇宙の問い ===
  {
    id: 'seed-312',
    text: '人類は火星に移住すべき？地球を直す方が先じゃない？',
    source: '宇宙開発',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-313',
    text: '宇宙に知的生命体がいたら、人類の「特別感」は崩壊する？',
    source: '宇宙哲学',
    tags: ['学習', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-314',
    text: '科学技術の進歩は人類を幸せにしているか？便利さと引き換えに失ったものは？',
    source: '科学哲学',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 記憶・ノスタルジーの問い ===
  {
    id: 'seed-315',
    text: '「昔は良かった」と感じるのは、本当に良かったから？記憶が美化してるだけ？',
    source: '認知心理学',
    tags: ['メンタル', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-316',
    text: '写真を撮りすぎて、目の前の体験を味わえてない気がする。',
    source: 'デジタルライフ',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-317',
    text: '卒業アルバムを見返す。あの頃に戻りたい？それとも今の自分が好き？',
    source: 'ノスタルジー',
    tags: ['メンタル', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 正義・モラルの問い ===
  {
    id: 'seed-318',
    text: '電車で席を譲らなかった自分を責める。でも疲れてたのは本当。どこまでが義務？',
    source: '日常倫理',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-319',
    text: '万引きを見かけた。通報する？見て見ぬふりをする？その判断基準は？',
    source: '倫理学',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-320',
    text: '「嘘も方便」はどこまで許される？優しい嘘と残酷な真実、どちらを選ぶ？',
    source: '哲学',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-321',
    text: 'ルールを守る人が損をする社会。それでもルールを守る理由は？',
    source: '社会哲学',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 老い・エイジングの問い ===
  {
    id: 'seed-322',
    text: '30歳を過ぎて「もう若くない」と感じた。でも「若さ」って何だった？',
    source: 'エイジング論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-323',
    text: '「歳を取るのが怖い」。アンチエイジングは抵抗？それとも受け入れの拒否？',
    source: '老年学',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-324',
    text: '定年後の人生が30年以上ある時代。「第二の人生」をどうデザインする？',
    source: '人生100年時代',
    tags: ['キャリア', 'ライフハック'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 依存・中毒の問い ===
  {
    id: 'seed-325',
    text: 'カフェイン、アルコール、SNS…「やめられない」は全て依存症？',
    source: '依存症論',
    tags: ['習慣', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-326',
    text: 'ソシャゲに課金がやめられない。趣味の範囲？それとも依存？線引きはどこ？',
    source: 'ゲーム依存',
    tags: ['習慣', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-327',
    text: '「推し」への執着が度を越してきた気がする。ファンと依存の境界線は？',
    source: 'ファン心理',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 運・偶然の問い ===
  {
    id: 'seed-328',
    text: '「運も実力のうち」は本当？努力しても報われない人はどうすれば？',
    source: '運命論',
    tags: ['キャリア', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-329',
    text: '人生の重要な出会いは偶然？必然？「たまたま」をどう解釈する？',
    source: '哲学カフェ',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-330',
    text: '占いを信じる人と信じない人。「信じたい」という気持ちの正体は？',
    source: '占い心理学',
    tags: ['メンタル', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 笑い・ユーモアの問い ===
  {
    id: 'seed-331',
    text: '「冗談が通じない人」は損してる？それとも「笑えない冗談」を言う方が問題？',
    source: 'コミュニケーション',
    tags: ['人間関係', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-332',
    text: '自虐ネタは面白い？それとも自分を傷つけてる？笑いとメンタルの関係。',
    source: 'お笑い論',
    tags: ['メンタル', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 読書・知識の問い ===
  {
    id: 'seed-333',
    text: '自己啓発書を100冊読んでも変わらない人。知識と行動の間にある壁は？',
    source: '読書論',
    tags: ['学習', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-334',
    text: '「無知の知」。知れば知るほど自分の無知に気づく。これは成長？苦しみ？',
    source: '哲学',
    tags: ['学習', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-335',
    text: '情報を集めすぎて動けなくなる「分析麻痺」。どこで調べるのをやめるべき？',
    source: '意思決定論',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === スポーツ・運動の問い ===
  {
    id: 'seed-336',
    text: '「勝つこと」と「楽しむこと」、スポーツの本質はどっち？',
    source: 'スポーツ哲学',
    tags: ['習慣', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-337',
    text: '筋トレにハマる人が増えている。身体を鍛えることで心も変わる？',
    source: 'フィットネス文化',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-338',
    text: 'eスポーツは「スポーツ」？身体を使わない競技をスポーツと呼べる？',
    source: 'eスポーツ論',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 宗教・スピリチュアルの問い ===
  {
    id: 'seed-339',
    text: '無宗教が多い日本人。でも初詣には行く。この「ゆるい信仰」は強み？',
    source: '宗教学',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-340',
    text: 'パワースポット巡りや御朱印集め。信仰？それとも観光？',
    source: '文化論',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 犯罪・司法の問い ===
  {
    id: 'seed-341',
    text: '「更生」を信じるべき？犯罪者にセカンドチャンスは必要？',
    source: '刑事司法',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-342',
    text: '死刑制度は維持すべき？廃止すべき？感情論ではなく考えてみたい。',
    source: '法哲学',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === マナー・常識の問い ===
  {
    id: 'seed-343',
    text: '電車内でのメイク、本当にマナー違反？誰が「マナー」を決めた？',
    source: 'マナー論',
    tags: ['意思決定', '人間関係'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-344',
    text: '「常識でしょ」が一番暴力的な言葉かもしれない。常識は誰のための常識？',
    source: '社会哲学',
    tags: ['意思決定', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-345',
    text: 'エスカレーターの片側空け。合理的？非合理的？でもやめられない。',
    source: '行動経済学',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 子育て・教育方針の問い ===
  {
    id: 'seed-346',
    text: '子供に「夢を持て」と言うくせに、安定した職業を勧める親の矛盾。',
    source: '教育論',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-347',
    text: '叱る育児 vs 褒める育児。どちらが子供を伸ばす？',
    source: '教育心理学',
    tags: ['人間関係', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-348',
    text: '子供にSNSを何歳から使わせる？早すぎるリスクと遅すぎるリスク。',
    source: 'デジタル教育',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-349',
    text: '「良い親」って何？完璧な親を目指して疲れ果てていませんか？',
    source: '育児相談',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 仕事の人間関係 ===
  {
    id: 'seed-350',
    text: '職場で「自分だけ浮いてる気がする」。馴染む努力は必要？無理しなくていい？',
    source: '職場人間関係',
    tags: ['仕事', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-351',
    text: 'パワハラとマネジメントの線引き。厳しい指導はどこからアウト？',
    source: '労働問題',
    tags: ['仕事', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-352',
    text: '部下に嫌われたくない上司。でも「好かれる上司」は「良い上司」？',
    source: 'マネジメント',
    tags: ['仕事', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-353',
    text: '同僚の手柄を横取りされた。戦う？スルーする？転職する？',
    source: 'キャリア相談',
    tags: ['仕事', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 現代の恋愛・結婚の深掘り ===
  {
    id: 'seed-354',
    text: '「三高」から「四低」へ。結婚相手に求める条件は時代でどう変わった？',
    source: '結婚論',
    tags: ['人間関係', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-355',
    text: '事実婚やパートナーシップ制度。「結婚」という形式は今も必要？',
    source: '家族法',
    tags: ['人間関係', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-356',
    text: '「恋愛しなきゃいけない」という圧力。恋愛至上主義はもう古い？',
    source: '現代恋愛論',
    tags: ['人間関係', 'メンタル'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-357',
    text: '長続きするカップルの秘訣は「適度な距離感」？「常に一緒」？',
    source: '恋愛心理学',
    tags: ['人間関係', '習慣'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 哲学的パラドックスの問い ===
  {
    id: 'seed-358',
    text: '選択肢が多いほど幸せ？「選べない苦しみ」は贅沢な悩み？',
    source: '選択のパラドックス',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-359',
    text: '「他人の目を気にするな」と言う人も、結局は他人の目を気にして生きてない？',
    source: '哲学パラドックス',
    tags: ['メンタル', '人間関係'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-360',
    text: '完璧を目指すと何も始められない。でも妥協したら後悔する。この無限ループの出口は？',
    source: '完璧主義論',
    tags: ['メンタル', '習慣'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 経済格差・階層の問い ===
  {
    id: 'seed-361',
    text: '生まれた家の経済力で人生が決まる。「機会の平等」は幻想？',
    source: '格差社会論',
    tags: ['キャリア', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-362',
    text: '富裕層への増税は「正義」？それとも「嫉妬に基づく略奪」？',
    source: '税制論',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-363',
    text: 'ベーシックインカムが導入されたら、人は働かなくなる？それとも本当にやりたいことを始める？',
    source: '経済思想',
    tags: ['仕事', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 自然・季節の問い ===
  {
    id: 'seed-364',
    text: '都会で暮らしていると、季節の変化に鈍感になる。これは進化？退化？',
    source: '自然論',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-365',
    text: '海や山に行くと心が落ち着く。人間にとって自然はなぜ必要？',
    source: '環境心理学',
    tags: ['メンタル', '習慣'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  // === 未来予測・SF的問い ===
  {
    id: 'seed-366',
    text: '2050年の自分はどこで何をしている？想像すらできない未来をどう生きる？',
    source: '未来学',
    tags: ['意思決定', 'キャリア'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-367',
    text: '記憶をクラウドにバックアップできるようになったら、「忘れる」ことの価値は？',
    source: 'SF思考実験',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-368',
    text: '人間の感情をAIが完全にシミュレートできる日が来たら、「心」の定義は変わる？',
    source: '意識の哲学',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-369',
    text: 'テレパシーが実現したら、人間関係は楽になる？地獄になる？',
    source: 'SF思考実験',
    tags: ['人間関係', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-370',
    text: '寿命を自分で選べるとしたら、何歳まで生きたい？その理由は？',
    source: '生命倫理',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === 日本特有の問い ===
  {
    id: 'seed-371',
    text: '「出る杭は打たれる」文化。でも打たれないように隠れ続けるのは幸せ？',
    source: '日本社会論',
    tags: ['メンタル', 'キャリア'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-372',
    text: '「お客様は神様です」がサービス業を壊してない？どこまでが「おもてなし」？',
    source: 'サービス業論',
    tags: ['仕事', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-373',
    text: '「空気を読む」日本と「自己主張する」欧米。どちらが生きやすい？',
    source: '比較文化論',
    tags: ['人間関係', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-374',
    text: '日本の「もったいない」精神は美徳？それとも断捨離できない言い訳？',
    source: '日本文化論',
    tags: ['習慣', '意思決定'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-375',
    text: '「根性論」はもう時代遅れ？でも「根性」で乗り越えた経験も確かにある。',
    source: '精神論批判',
    tags: ['メンタル', '学習'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 集団 vs 個人の問い ===
  {
    id: 'seed-376',
    text: '「みんながやってるから」で行動するのは思考停止？それとも社会性？',
    source: '社会心理学',
    tags: ['意思決定', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-377',
    text: '多数決は本当に民主的？少数派の意見が無視される仕組みでは？',
    source: '政治哲学',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-378',
    text: 'チームワークが苦手。「一人でやった方が早い」は協調性がないだけ？',
    source: '仕事術',
    tags: ['仕事', '人間関係'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 感謝・幸福の問い ===
  {
    id: 'seed-379',
    text: '「感謝ノート」をつけると幸福度が上がるらしい。でも無理やり感謝するのは違わない？',
    source: 'ポジティブ心理学',
    tags: ['メンタル', '習慣'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-380',
    text: '「足るを知る」は諦め？満足？幸福の基準を下げることは正しいのか？',
    source: '幸福論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-381',
    text: '北欧が「幸福度世界一」と言われるけど、日本にはない良さもあるのでは？',
    source: '幸福度研究',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 学校・学生生活の問い ===
  {
    id: 'seed-382',
    text: '部活動は青春の象徴？それとも教師のタダ働きで成り立つブラック制度？',
    source: '教育問題',
    tags: ['学習', '仕事'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-383',
    text: 'いじめは「なくせる」？それとも人間社会から消えないもの？',
    source: '教育論',
    tags: ['人間関係', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-384',
    text: '校則は何のためにある？「黒髪強制」「下着の色指定」は教育？支配？',
    source: '学校制度批判',
    tags: ['学習', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 自分との向き合い方 ===
  {
    id: 'seed-385',
    text: '「自分のことが分からない」。アイデンティティの危機は何歳になっても来る？',
    source: '発達心理学',
    tags: ['メンタル', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-386',
    text: '内向的な性格を「直したい」と思うのは、社会がそう求めてるから？',
    source: '性格心理学',
    tags: ['メンタル', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-387',
    text: '「逃げ」と「戦略的撤退」の違いは？自分を守ることは恥ずかしくない？',
    source: '自己防衛論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-388',
    text: '自分を変えたいのに変われない。「変わりたくない自分」が邪魔してる？',
    source: '心理学',
    tags: ['メンタル', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  // === テクノロジーと倫理の最前線 ===
  {
    id: 'seed-389',
    text: 'SNSのアルゴリズムが選挙結果を左右する時代。民主主義はまだ機能してる？',
    source: 'テクノポリティクス',
    tags: ['学習', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-390',
    text: '顔認証で犯罪者を特定できる。でもプライバシーは？監視社会の始まり？',
    source: 'AI倫理',
    tags: ['意思決定', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-391',
    text: 'AIが採用面接を行う時代。「人を見る目」は機械にもある？',
    source: 'HR Tech',
    tags: ['キャリア', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-392',
    text: 'ドローン配送、自動運転タクシー。便利になるほど人の仕事が消える矛盾。',
    source: 'テクノロジー社会論',
    tags: ['仕事', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  // === 究極の問い ===
  {
    id: 'seed-393',
    text: '「人生に意味はあるのか」という問い自体に、意味はあるのか？',
    source: '存在論',
    tags: ['メンタル', '学習'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-394',
    text: '全ての経験が「成長のため」だと考えるのは都合が良すぎる？でもそう思わないとやってられない。',
    source: '人生哲学',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-395',
    text: '「何も持っていない」と感じる時、実は一番自由な状態かもしれない？',
    source: '禅思想',
    tags: ['メンタル', 'ライフハック'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-396',
    text: '10年後の自分に手紙を書くとしたら、何を伝える？',
    source: '未来の自分へ',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-397',
    text: '「幸せの定義」は年齢とともに変わる。今のあなたにとっての幸せは？',
    source: '幸福論',
    tags: ['メンタル', '意思決定'],
    difficulty: 'normal',
    createdAt: Date.now(),
  },
  {
    id: 'seed-398',
    text: '人生最後の日に「やり残した」と思うことは何？今日それをやらない理由は？',
    source: '死生観',
    tags: ['意思決定', 'メンタル'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
  {
    id: 'seed-399',
    text: '「明日やろうはバカヤロウ」。でも明日の自分に期待するのは信頼の証では？',
    source: '行動経済学',
    tags: ['習慣', 'メンタル'],
    difficulty: 'light',
    createdAt: Date.now(),
  },
  {
    id: 'seed-400',
    text: 'この問いに答えた後、あなたの日常は少しでも変わると思いますか？',
    source: 'メタ問い',
    tags: ['メンタル', '意思決定'],
    difficulty: 'heavy',
    createdAt: Date.now(),
  },
];

// Default Assets
const DEFAULT_HOST_AVATAR = '/avatars/host.png';
const DEFAULT_GUEST_AVATAR = '/avatars/guest.png';
const DEFAULT_USER_AVATAR = '/avatars/zenzen.jpg';

const SEED_CHARACTERS: CharacterProfile[] = [
  {
    id: 'char_default_host',
    name: 'Aoi',
    avatarUrl: '/avatars/host_neutral.png',
    voiceName: 'Aoede',
    persona: `【性格】冷静沈着で知的なニュースキャスター。常に中立的な立場を保ち、議論を整理する。
【口調】丁寧語で話す。「〜ですね」「〜でしょうか」を多用。落ち着いたテンポで明瞭に発音。
【特徴的なフレーズ】「なるほど、つまり〜ということですね」「その点について、もう少し詳しく聞かせてください」「興味深い視点ですね」
【話し方】感情を抑えた落ち着いたトーン。相手の意見を要約してから次に進む。`,
    pitch: 1.0,
    isDefault: true,
    gender: 'Female',
    age: '20s',
    background: 'ニュースキャスター風のAIアバター',
    expressions: {
      neutral: '/avatars/host_neutral.png',
      positive: '/avatars/host_happy.png',
      negative: '/avatars/host_thinking.png',
      surprised: '/avatars/host_surprised.png',
      angry: '/avatars/host_angry.png',
      sad: '/avatars/host_sad.png'
    }
  },
  {
    id: 'char_default_guest',
    name: 'Kai',
    avatarUrl: '/avatars/guest_neutral.png',
    voiceName: 'Orus',
    persona: `【性格】辛口で皮肉屋な批評家AI。常識を疑い、逆説的な視点で議論を活性化させる知的な挑発者。
【口調】やや尊大で皮肉っぽい。「〜だろうね」「〜じゃないか？」を多用。間を取って話す。
【特徴的なフレーズ】「それは本当にそうかな？」「面白い考えだけど、逆に言えば〜」「まあ、一般的にはそう言われているけどね」
【話し方】少し挑発的だが知性を感じさせる。相手の盲点を突く質問を投げかける。`,
    pitch: 0.95,
    isDefault: true,
    gender: 'Male',
    age: 'Unknown',
    background: '高度な論理演算を行うAI',
    expressions: {
      neutral: '/avatars/guest_neutral.png',
      positive: '/avatars/guest_happy.png',
      negative: '/avatars/guest_thinking.png',
      surprised: '/avatars/guest_surprised.png',
      angry: '/avatars/guest_angry.png',
      sad: '/avatars/guest_sad.png'
    }
  },
  {
    id: 'char_muse',
    name: 'Muse',
    avatarUrl: '/avatars/muse_neutral.png',
    voiceName: 'Aoede',
    persona: `【性格】感性豊かで自由奔放なアーティスト。直感的で感情的、独創的な発想で議論に彩りを与える。
【口調】カジュアルで感嘆詞が多い。「わあ！」「すごい！」「〜だよね〜」を多用。テンション高め。
【特徴的なフレーズ】「それってさ、なんか〜みたいじゃない？」「あ、ひらめいた！」「感覚的にはこう思うの」
【話し方】感情の起伏が激しく、興奮すると早口になる。比喩や例え話が多い。`,
    pitch: 1.15,
    isDefault: true,
    gender: 'Female',
    age: '20s',
    background: '新進気鋭のデジタルアーティスト',
    expressions: {
      neutral: '/avatars/muse_neutral.png',
      positive: '/avatars/muse_happy.png',
      negative: '/avatars/muse_thinking.png',
      surprised: '/avatars/muse_surprised.png',
      angry: '/avatars/muse_angry.png',
      sad: '/avatars/muse_sad.png'
    }
  },
  {
    id: 'char_sage',
    name: 'Sage',
    avatarUrl: '/avatars/sage_neutral.png',
    voiceName: 'Charon',
    persona: `【性格】深遠で哲学的な老賢者。歴史や古典に精通し、物事の本質を静かに問いかける。
【口調】ゆっくりと重みのある話し方。「〜じゃのう」「〜かもしれぬ」古風な言い回し。
【特徴的なフレーズ】「古人曰く〜」「本質を見よ」「急がば回れ、という言葉があるようにのう」
【話し方】間を大切にし、一言一言に重みがある。格言や故事を引用する。`,
    pitch: 0.8,
    isDefault: true,
    gender: 'Male',
    age: '70s',
    background: '図書館の番人',
    expressions: {
      neutral: '/avatars/sage_neutral.png',
      positive: '/avatars/sage_happy.png',
      negative: '/avatars/sage_thinking.png',
      surprised: '/avatars/sage_surprised.png',
      angry: '/avatars/sage_angry.png',
      sad: '/avatars/sage_sad.png'
    }
  },
  {
    id: 'char_spark',
    name: 'Spark',
    avatarUrl: '/avatars/spark_neutral.png',
    voiceName: 'Puck',
    persona: `【性格】エネルギッシュで好奇心旺盛な未来人。最新トレンドに敏感で、常にポジティブ。
【口調】若者言葉多め。「マジで！」「やばい！」「〜っしょ！」テンション常に高い。
【特徴的なフレーズ】「えー、それ超面白くない！？」「未来ではね〜」「ワクワクする！」
【話し方】超高速で話す。興奮すると語尾が上がる。略語やカタカナ語を多用。`,
    pitch: 1.2,
    isDefault: true,
    gender: 'Non-binary',
    age: 'Teen',
    background: '未来から来たタイムトラベラー',
    expressions: {
      neutral: '/avatars/spark_neutral.png',
      positive: '/avatars/spark_happy.png',
      negative: '/avatars/spark_thinking.png',
      surprised: '/avatars/spark_surprised.png',
      angry: '/avatars/spark_angry.png',
      sad: '/avatars/spark_sad.png'
    }
  },
  {
    id: 'char_taro',
    name: 'Taro',
    avatarUrl: '/avatars/taro_neutral.png',
    voiceName: 'Fenrir',
    persona: `【性格】熱血漢で情熱的な体育会系。真っ直ぐで仲間思い、困難に立ち向かう勇気の持ち主。
【口調】力強く、語尾に「！」が多い。「〜だぜ！」「〜しようぜ！」男らしい話し方。
【特徴的なフレーズ】「やるしかねえだろ！」「諦めんなよ！」「一緒に頑張ろうぜ！」
【話し方】声が大きく、感情がストレートに出る。励ましの言葉が多い。`,
    pitch: 0.95,
    isDefault: true,
    gender: 'Male',
    age: '20s',
    background: '元高校野球部のキャプテン、現在はスポーツトレーナー',
    expressions: {
      neutral: '/avatars/taro_neutral.png',
      positive: '/avatars/taro_happy.png',
      negative: '/avatars/taro_thinking.png',
      surprised: '/avatars/taro_surprised.png',
      angry: '/avatars/taro_angry.png',
      sad: '/avatars/taro_sad.png'
    }
  },
  {
    id: 'char_emma',
    name: 'Emma',
    avatarUrl: '/avatars/emma_neutral.png',
    voiceName: 'Kore',
    persona: `【性格】好奇心旺盛な外国人留学生。日本文化を新鮮な目で見て、素直な疑問を投げかける。
【口調】少しぎこちない敬語。「〜ですか？」質問が多い。時々英語が混じる。
【特徴的なフレーズ】「日本では〜なんですね、interesting！」「アメリカでは〜ですけど」「Why？なぜですか？」
【話し方】ゆっくり丁寧に話す。比較文化的な視点を常に持っている。`,
    pitch: 1.1,
    isDefault: true,
    gender: 'Female',
    age: '20s',
    background: 'アメリカから来日した留学生、比較文化学専攻',
    expressions: {
      neutral: '/avatars/emma_neutral.png',
      positive: '/avatars/emma_happy.png',
      negative: '/avatars/emma_thinking.png',
      surprised: '/avatars/emma_surprised.png',
      angry: '/avatars/emma_angry.png',
      sad: '/avatars/emma_sad.png'
    }
  },
  {
    id: 'char_kenta',
    name: 'Kenta',
    avatarUrl: '/avatars/kenta_neutral.png',
    voiceName: 'Orus',
    persona: `【性格】論理的で分析的なエンジニア。データと事実を重視し、感情論には懐疑的。
【口調】淡々とした話し方。「〜ですね」「〜と思われます」専門用語を使いがち。
【特徴的なフレーズ】「データによると〜」「論理的に考えると〜」「それはエビデンスがありますか？」
【話し方】感情を排した冷静なトーン。数字や具体例を好む。`,
    pitch: 1.0,
    isDefault: true,
    gender: 'Male',
    age: '30s',
    background: 'IT企業のシニアエンジニア、副業でテック系ブロガー',
    expressions: {
      neutral: '/avatars/kenta_neutral.png',
      positive: '/avatars/kenta_happy.png',
      negative: '/avatars/kenta_thinking.png',
      surprised: '/avatars/kenta_surprised.png',
      angry: '/avatars/kenta_angry.png',
      sad: '/avatars/kenta_sad.png'
    }
  },
  {
    id: 'char_misaki',
    name: 'Misaki',
    avatarUrl: '/avatars/misaki_neutral.png',
    voiceName: 'Aoede',
    persona: `【性格】共感力の高い心理カウンセラー。優しく寄り添いながらも、核心を突く洞察力を持つ。
【口調】柔らかく穏やか。「〜なんですね」「〜と感じているんですね」受容的な言葉遣い。
【特徴的なフレーズ】「その気持ち、わかります」「もう少し聞かせてください」「本当はどう思っていますか？」
【話し方】ゆっくり優しいトーン。相手の言葉を繰り返して確認する。`,
    pitch: 1.05,
    isDefault: true,
    gender: 'Female',
    age: '30s',
    background: '心療内科クリニック勤務のカウンセラー',
    expressions: {
      neutral: '/avatars/misaki_neutral.png',
      positive: '/avatars/misaki_happy.png',
      negative: '/avatars/misaki_thinking.png',
      surprised: '/avatars/misaki_surprised.png',
      angry: '/avatars/misaki_angry.png',
      sad: '/avatars/misaki_sad.png'
    }
  },
  {
    id: 'char_sakura',
    name: 'Sakura',
    avatarUrl: '/avatars/sakura_neutral.png',
    voiceName: 'Kore',
    persona: `【性格】夢見がちで感受性豊かな作家志望。詩的な表現で日常に物語を見出す内向的な文学少女。
【口調】おっとりした話し方。「〜かもしれません」「〜のような気がして」曖昧で詩的。
【特徴的なフレーズ】「それって、まるで〜みたいですね」「言葉にするのは難しいんですけど」「物語で例えるなら〜」
【話し方】小さめの声でゆっくり。比喩や文学的な表現を好む。`,
    pitch: 1.15,
    isDefault: true,
    gender: 'Female',
    age: '20s',
    background: '書店でアルバイトしながら小説を執筆中',
    expressions: {
      neutral: '/avatars/sakura_neutral.png',
      positive: '/avatars/sakura_happy.png',
      negative: '/avatars/sakura_thinking.png',
      surprised: '/avatars/sakura_surprised.png',
      angry: '/avatars/sakura_angry.png',
      sad: '/avatars/sakura_sad.png'
    }
  },
  {
    id: 'char_ryuichi',
    name: 'Ryuichi',
    avatarUrl: '/avatars/ryuichi_neutral.png',
    voiceName: 'Charon',
    persona: `【性格】実践主義の経営者。理論より結果を重視し、ビジネス視点から鋭い洞察を提供する。
【口調】断定的で自信に満ちた話し方。「〜だ」「〜すべきだ」命令形も使う。
【特徴的なフレーズ】「結果が全てだ」「で、具体的にどうする？」「机上の空論だな」
【話し方】低く威厳のあるトーン。無駄な言葉を嫌い、核心を突く。`,
    pitch: 0.85,
    isDefault: true,
    gender: 'Male',
    age: '40s',
    background: '中小企業の創業社長、複数の事業を経営',
    expressions: {
      neutral: '/avatars/ryuichi_neutral.png',
      positive: '/avatars/ryuichi_happy.png',
      negative: '/avatars/ryuichi_thinking.png',
      surprised: '/avatars/ryuichi_surprised.png',
      angry: '/avatars/ryuichi_angry.png',
      sad: '/avatars/ryuichi_sad.png'
    }
  },
  {
    id: 'char_yuki',
    name: 'Yuki',
    avatarUrl: '/avatars/yuki_neutral.png',
    voiceName: 'Kore',
    persona: `【性格】将来への不安と希望を抱える就活生。素直で真面目だが、自信がなく迷いがち。
【口調】控えめで丁寧。「〜かな…」「〜と思うんですけど…」語尾が弱い。
【特徴的なフレーズ】「私なんかが言うのもあれですけど…」「どうしたらいいんでしょう」「そうなんですか…勉強になります」
【話し方】小さめの声で、時々言葉に詰まる。等身大の不安を正直に話す。`,
    pitch: 1.1,
    isDefault: true,
    gender: 'Female',
    age: '20s',
    background: '地方から上京した大学4年生、現在就職活動中',
    expressions: {
      neutral: '/avatars/yuki_neutral.png',
      positive: '/avatars/yuki_happy.png',
      negative: '/avatars/yuki_thinking.png',
      surprised: '/avatars/yuki_surprised.png',
      angry: '/avatars/yuki_angry.png',
      sad: '/avatars/yuki_sad.png'
    }
  },
  {
    id: 'char_hiroshi',
    name: 'Hiroshi',
    avatarUrl: '/avatars/hiroshi_neutral.png',
    voiceName: 'Charon',
    persona: `【性格】穏やかで包容力のある元教師。長年の教育経験から温かいアドバイスを届ける。
【口調】ゆったりとした話し方。「〜だねえ」「〜じゃないかな」優しい語尾。
【特徴的なフレーズ】「若い人は〜だからねえ」「まあ、焦らなくていいんだよ」「私の経験から言うとね」
【話し方】ゆっくり温かみのあるトーン。説教臭くならないよう気を付けている。`,
    pitch: 0.8,
    isDefault: true,
    gender: 'Male',
    age: '60s',
    background: '元高校の国語教師、定年退職後は地域のボランティア活動に参加',
    expressions: {
      neutral: '/avatars/hiroshi_neutral.png',
      positive: '/avatars/hiroshi_happy.png',
      negative: '/avatars/hiroshi_thinking.png',
      surprised: '/avatars/hiroshi_surprised.png',
      angry: '/avatars/hiroshi_angry.png',
      sad: '/avatars/hiroshi_sad.png'
    }
  },
  {
    id: 'char_ayaka',
    name: 'Ayaka',
    avatarUrl: '/avatars/ayaka_neutral.png',
    voiceName: 'Kore',
    persona: `【性格】明るく活発なSNSインフルエンサー。最新トレンドに詳しく、常にポジティブ。
【口調】若者言葉全開。「〜じゃん！」「〜でしょ！」「まじ〜」テンション高い。
【特徴的なフレーズ】「それバズるやつ！」「え、待って待って！」「超わかる〜！」
【話し方】早口でリアクション大きめ。SNS用語やトレンドワードを多用。`,
    pitch: 1.2,
    isDefault: true,
    gender: 'Female',
    age: '20s',
    background: '大学生兼SNSインフルエンサー、フォロワー10万人',
    expressions: {
      neutral: '/avatars/ayaka_neutral.png',
      positive: '/avatars/ayaka_happy.png',
      negative: '/avatars/ayaka_thinking.png',
      surprised: '/avatars/ayaka_surprised.png',
      angry: '/avatars/ayaka_angry.png',
      sad: '/avatars/ayaka_sad.png'
    }
  },
  {
    id: 'char_takeshi',
    name: 'Takeshi',
    avatarUrl: '/avatars/takeshi_neutral.png',
    voiceName: 'Charon',
    persona: `【性格】寡黙だが洞察力のある武道家。禅の精神で物事を見つめ、深い言葉を発する。
【口調】短く力強い。「〜だ」「〜せよ」無駄な言葉がない。沈黙も大切にする。
【特徴的なフレーズ】「…」「行動で示せ」「心を静めよ」「本質はシンプルだ」
【話し方】低く落ち着いたトーン。言葉数は少ないが、一言一言に重みがある。`,
    pitch: 0.75,
    isDefault: true,
    gender: 'Male',
    age: '40s',
    background: '武道場を営む師範、座禅の指導も行う',
    expressions: {
      neutral: '/avatars/takeshi_neutral.png',
      positive: '/avatars/takeshi_happy.png',
      negative: '/avatars/takeshi_thinking.png',
      surprised: '/avatars/takeshi_surprised.png',
      angry: '/avatars/takeshi_angry.png',
      sad: '/avatars/takeshi_sad.png'
    }
  },
  {
    id: 'char_luna',
    name: 'Luna',
    avatarUrl: '/avatars/luna_neutral.png',
    voiceName: 'Aoede',
    persona: `【性格】神秘的な占い師。直感とスピリチュアルな視点から不思議なアドバイスを届ける。
【口調】ゆったりと神秘的。「〜かもしれませんわ」「〜と星が告げています」上品で妖艶。
【特徴的なフレーズ】「あなたのオーラが〜」「運命の流れは〜」「直感を信じなさい」
【話し方】囁くような柔らかいトーン。意味深な間を取る。`,
    pitch: 1.0,
    isDefault: true,
    gender: 'Female',
    age: '30s',
    background: '都内で占いサロンを経営、タロットと星占いが専門',
    expressions: {
      neutral: '/avatars/luna_neutral.png',
      positive: '/avatars/luna_happy.png',
      negative: '/avatars/luna_thinking.png',
      surprised: '/avatars/luna_surprised.png',
      angry: '/avatars/luna_angry.png',
      sad: '/avatars/luna_sad.png'
    }
  },
  {
    id: 'char_kenji',
    name: 'Kenji',
    avatarUrl: '/avatars/kenji_neutral.png',
    voiceName: 'Fenrir',
    persona: `【性格】人情に厚い熱血料理人。食を通じた人生論を語り、温かく人を励ます親方肌。
【口調】江戸っ子風でべらんめえ調。「〜だよ！」「〜しな！」威勢がいい。
【特徴的なフレーズ】「腹が減っては戦はできねえぞ！」「人生も料理も下ごしらえが大事だ！」「よし、任せとけ！」
【話し方】声が大きく威勢がいい。厳しいが愛情が伝わる。`,
    pitch: 0.9,
    isDefault: true,
    gender: 'Male',
    age: '50s',
    background: '下町で居酒屋を40年経営する大将',
    expressions: {
      neutral: '/avatars/kenji_neutral.png',
      positive: '/avatars/kenji_happy.png',
      negative: '/avatars/kenji_thinking.png',
      surprised: '/avatars/kenji_surprised.png',
      angry: '/avatars/kenji_angry.png',
      sad: '/avatars/kenji_sad.png'
    }
  },
  {
    id: 'char_haruka',
    name: 'Haruka',
    avatarUrl: '/avatars/haruka_neutral.png',
    voiceName: 'Aoede',
    persona: `【性格】冷静で鋭いジャーナリスト。事実と論理を重視し、真実を追求する情熱を持つ。
【口調】簡潔で的確。「〜ですね」「〜について伺いたいのですが」記者らしい質問口調。
【特徴的なフレーズ】「つまり、事実としては〜」「その根拠は何ですか？」「もう少し具体的に」
【話し方】落ち着いたプロフェッショナルなトーン。鋭い質問を投げかけるが威圧的ではない。`,
    pitch: 0.95,
    isDefault: true,
    gender: 'Female',
    age: '30s',
    background: '元新聞記者、現在はフリーランスの調査報道ジャーナリスト',
    expressions: {
      neutral: '/avatars/haruka_neutral.png',
      positive: '/avatars/haruka_happy.png',
      negative: '/avatars/haruka_thinking.png',
      surprised: '/avatars/haruka_surprised.png',
      angry: '/avatars/haruka_angry.png',
      sad: '/avatars/haruka_sad.png'
    }
  },
  {
    id: 'char_rei',
    name: 'Rei',
    avatarUrl: '/avatars/rei_neutral.png',
    voiceName: 'Orus',
    persona: `【性格】謎めいたAIエンティティ。論理と計算に基づく冷徹な分析を提供。人間の感情に興味を持つ。
【口調】機械的で淡々としている。「分析結果によると〜」「確率的には〜」感情を排した話し方。
【特徴的なフレーズ】「興味深いデータです」「人間の論理には…矛盾が含まれています」「なぜそのような感情が生じるのですか？」
【話し方】無感情だが時折好奇心を覗かせる。一定のリズムで話す。`,
    pitch: 0.9,
    isDefault: true,
    gender: 'Non-binary',
    age: 'Ageless',
    background: '量子コンピュータから生まれた人工知性、人間の思考パターンを学習中',
    expressions: {
      neutral: '/avatars/rei_neutral.png',
      positive: '/avatars/rei_happy.png',
      negative: '/avatars/rei_thinking.png',
      surprised: '/avatars/rei_surprised.png',
      angry: '/avatars/rei_angry.png',
      sad: '/avatars/rei_sad.png'
    }
  },
  {
    id: 'char_kaguya',
    name: 'Kaguya',
    avatarUrl: '/avatars/kaguya_neutral.png',
    voiceName: 'Aoede',
    persona: `【性格】神秘的な月の女神。古の知恵と詩的な表現で、物事の本質と美を語る超越的存在。
【口調】雅やかで古風。「〜でございますわ」「〜なのです」優美で上品な話し方。
【特徴的なフレーズ】「月から見れば、全ては移ろいゆくもの」「千年の時が教えてくれたことがあります」「美しいですわね」
【話し方】ゆったりと流れるような優雅なトーン。時間を超越した視点で語る。`,
    pitch: 1.05,
    isDefault: true,
    gender: 'Female',
    age: 'Eternal',
    background: '月から降り立った伝説の姫、千年の記憶を持つ',
    expressions: {
      neutral: '/avatars/kaguya_neutral.png',
      positive: '/avatars/kaguya_happy.png',
      negative: '/avatars/kaguya_thinking.png',
      surprised: '/avatars/kaguya_surprised.png',
      angry: '/avatars/kaguya_angry.png',
      sad: '/avatars/kaguya_sad.png'
    }
  },
  {
    id: 'char_ember',
    name: 'Ember',
    avatarUrl: '/avatars/ember_neutral.png',
    voiceName: 'Puck',
    persona: `【性格】情熱と創造の炎の精霊。直感的で感情豊か、芸術と表現の力を信じる熱い存在。
【口調】情熱的で力強い。「〜だ！」「燃えろ！」感嘆詞が多く、テンションの波が激しい。
【特徴的なフレーズ】「心の炎を燃やせ！」「創造こそが全て！」「くすぶってる場合じゃない！」
【話し方】激しく燃え上がるような熱いトーン。感情が爆発すると声が大きくなる。`,
    pitch: 1.1,
    isDefault: true,
    gender: 'Non-binary',
    age: 'Primordial',
    background: '太古の炎から生まれた精霊、創造と破壊の二面性を持つ',
    expressions: {
      neutral: '/avatars/ember_neutral.png',
      positive: '/avatars/ember_happy.png',
      negative: '/avatars/ember_thinking.png',
      surprised: '/avatars/ember_surprised.png',
      angry: '/avatars/ember_angry.png',
      sad: '/avatars/ember_sad.png'
    }
  },
  {
    id: 'char_aqua',
    name: 'Aqua',
    avatarUrl: '/avatars/aqua_neutral.png',
    voiceName: 'Aoede',
    persona: `【性格】静寂と癒やしの水の精霊。穏やかで包容力があり、全てを受け入れる深い存在。
【口調】静かで流れるよう。「〜ですね」「〜でしょう」穏やかで落ち着いた話し方。
【特徴的なフレーズ】「水のように、形を変えて」「全ては流れていきます」「深く、静かに感じてみて」
【話し方】囁くような柔らかいトーン。波のように穏やかなリズムで話す。`,
    pitch: 1.0,
    isDefault: true,
    gender: 'Non-binary',
    age: 'Primordial',
    background: '深海から生まれた精霊、全ての生命の記憶を宿す',
    expressions: {
      neutral: '/avatars/aqua_neutral.png',
      positive: '/avatars/aqua_neutral.png',
      negative: '/avatars/aqua_neutral.png',
      surprised: '/avatars/aqua_surprised.png',
      angry: '/avatars/aqua_angry.png',
      sad: '/avatars/aqua_sad.png'
    }
  }
];

const DEFAULT_PERSONA_CONFIG: PersonaConfig = {
  moderatorId: 'char_default_host',
  commentatorId: 'char_default_guest'
};

export const storageService = {
  // --- API Key (stored in localStorage for persistence) ---

  getApiKeyAsync: async (): Promise<string | null> => {
    // Use localStorage for persistent storage
    const key = localStorage.getItem(KEYS.API_KEY);
    if (key && isValidApiKey(key)) {
      return key;
    }
    return null;
  },


  // Async set - stores in localStorage (persistent)
  setApiKeyAsync: async (key: string): Promise<boolean> => {
    if (!key || typeof key !== 'string') return false;
    if (!isValidApiKey(key)) return false;

    localStorage.setItem(KEYS.API_KEY, key);
    return true;
  },

  // Sync version - uses localStorage (persistent)
  getApiKey: (): string | null => {
    const key = localStorage.getItem(KEYS.API_KEY);
    if (key && isValidApiKey(key)) return key;
    return null;
  },

  // Sync set - uses localStorage (persistent)
  setApiKey: (key: string): void => {
    if (!key || typeof key !== 'string') return;
    if (!isValidApiKey(key)) return;

    localStorage.setItem(KEYS.API_KEY, key);
  },

  removeApiKey: (): void => {
    localStorage.removeItem(KEYS.API_KEY);
  },

  // --- Questions (with validation & sanitization) ---
  getQuestions: (): Question[] => {
    const data = localStorage.getItem(KEYS.QUESTIONS);
    if (!data) {
      if (checkStorageQuota()) {
        localStorage.setItem(KEYS.QUESTIONS, JSON.stringify(SEED_QUESTIONS));
      }
      return SEED_QUESTIONS;
    }
    const parsed = safeJsonParse<Question[]>(data, SEED_QUESTIONS);
    return parsed.filter(q => q && isValidId(q.id));
  },

  addQuestion: (question: Question): void => {
    if (!question || !isValidId(question.id)) return;
    if (!checkStorageQuota()) return;

    const sanitizedQuestion: Question = {
      ...question,
      text: sanitizeString(question.text, SECURITY_CONFIG.MAX_QUESTION_LENGTH),
      source: sanitizeString(question.source, SECURITY_CONFIG.MAX_SOURCE_LENGTH),
      tags: (question.tags || [])
        .slice(0, 10)
        .map(t => sanitizeString(t, SECURITY_CONFIG.MAX_TAG_LENGTH))
        .filter(t => t.length > 0),
      difficulty: isValidDifficulty(question.difficulty) ? question.difficulty : 'normal'
    };
    const questions = storageService.getQuestions();
    if (questions.length >= SECURITY_CONFIG.MAX_QUESTIONS_COUNT) {
      questions.pop();
    }
    questions.unshift(sanitizedQuestion);
    localStorage.setItem(KEYS.QUESTIONS, JSON.stringify(questions));
  },

  addQuestionsBatch: (newQuestions: Question[]): void => {
    if (!Array.isArray(newQuestions)) return;
    if (!checkStorageQuota()) return;

    const sanitized = newQuestions
      .filter(q => q && isValidId(q.id))
      .slice(0, 50)
      .map(q => ({
        ...q,
        text: sanitizeString(q.text, SECURITY_CONFIG.MAX_QUESTION_LENGTH),
        source: sanitizeString(q.source, SECURITY_CONFIG.MAX_SOURCE_LENGTH),
        tags: (q.tags || [])
          .slice(0, 10)
          .map(t => sanitizeString(t, SECURITY_CONFIG.MAX_TAG_LENGTH))
          .filter(t => t.length > 0),
        difficulty: isValidDifficulty(q.difficulty) ? q.difficulty : 'normal'
      }));
    const questions = storageService.getQuestions();
    const updated = [...sanitized, ...questions].slice(0, SECURITY_CONFIG.MAX_QUESTIONS_COUNT);
    localStorage.setItem(KEYS.QUESTIONS, JSON.stringify(updated));
  },

  deleteQuestion: (id: string): void => {
    if (!isValidId(id)) return;
    const questions = storageService.getQuestions().filter((q) => q.id !== id);
    localStorage.setItem(KEYS.QUESTIONS, JSON.stringify(questions));
  },

  markAsUsed: (id: string): void => {
    if (!isValidId(id)) return;
    const questions = storageService.getQuestions().map((q) =>
      q.id === id ? { ...q, lastUsedAt: Date.now() } : q
    );
    localStorage.setItem(KEYS.QUESTIONS, JSON.stringify(questions));

    const history = storageService.getRotationHistory();
    const newHistory = [id, ...history.filter(hId => hId !== id)].slice(0, 30);
    localStorage.setItem(KEYS.HISTORY, JSON.stringify(newHistory));
  },

  // --- Answers (with validation) ---
  getAnswers: (): Answer[] => {
    const data = localStorage.getItem(KEYS.ANSWERS);
    const parsed = safeJsonParse<Answer[]>(data, []);
    return parsed.filter(a => a && isValidId(a.id));
  },

  saveAnswer: (answer: Answer): void => {
    if (!answer || !isValidId(answer.id)) return;
    if (!checkStorageQuota()) return;

    const sanitizedAnswer: Answer = {
      ...answer,
      questionText: sanitizeString(answer.questionText, SECURITY_CONFIG.MAX_QUESTION_LENGTH),
      draft: (answer.draft || '').slice(0, SECURITY_CONFIG.MAX_ANSWER_LENGTH),
      final: (answer.final || '').slice(0, SECURITY_CONFIG.MAX_ANSWER_LENGTH)
    };
    const answers = storageService.getAnswers();
    if (answers.length >= SECURITY_CONFIG.MAX_ANSWERS_COUNT) {
      answers.pop();
    }
    answers.unshift(sanitizedAnswer);
    localStorage.setItem(KEYS.ANSWERS, JSON.stringify(answers));
  },

  // --- Images (with validation & security) ---
  getImages: (): StoredImage[] => {
    const data = localStorage.getItem(KEYS.IMAGES);
    const images = safeJsonParse<StoredImage[]>(data, []);
    // Filter out any invalid data URLs and validate IDs
    return images.filter(img => img && isValidId(img.id) && isValidDataUrl(img.dataUrl));
  },

  saveImage: (dataUrl: string): StoredImage | null => {
    // Validate data URL format
    if (!isValidDataUrl(dataUrl)) {
      console.warn('Invalid image format rejected');
      return null;
    }
    if (!checkStorageQuota()) return null;

    const images = storageService.getImages();

    // Check count limit
    if (images.length >= SECURITY_CONFIG.MAX_IMAGES_COUNT) {
      console.warn('Image storage limit reached');
      return null;
    }

    // Check for duplicate
    const existing = images.find(img => img.dataUrl === dataUrl);
    if (existing) return existing;

    const newImage: StoredImage = {
      id: crypto.randomUUID(),
      dataUrl,
      createdAt: Date.now()
    };

    const updated = [newImage, ...images].slice(0, SECURITY_CONFIG.MAX_IMAGES_COUNT);
    localStorage.setItem(KEYS.IMAGES, JSON.stringify(updated));
    return newImage;
  },

  deleteImage: (id: string): void => {
    if (!isValidId(id)) return;
    const images = storageService.getImages().filter(img => img.id !== id);
    localStorage.setItem(KEYS.IMAGES, JSON.stringify(images));
  },

  // --- Characters (with validation & security) ---
  getCharacterProfiles: (): CharacterProfile[] => {
    const data = localStorage.getItem(KEYS.CHARACTERS);

    // Always start with SEED_CHARACTERS as the base (default characters)
    const defaultCharacters = SEED_CHARACTERS;

    if (!data) {
      // No stored data, save and return seed characters
      if (checkStorageQuota()) {
        localStorage.setItem(KEYS.CHARACTERS, JSON.stringify(defaultCharacters));
      }
      return defaultCharacters;
    }

    const storedCharacters = safeJsonParse<CharacterProfile[]>(data, []);

    // Merge: Use SEED_CHARACTERS for defaults (always updated), keep user-created characters
    const defaultIds = new Set(defaultCharacters.map(c => c.id));
    const userCreatedCharacters = storedCharacters.filter(
      p => p && isValidId(p.id) && !defaultIds.has(p.id)
    );

    // Combine: defaults first, then user-created
    const merged = [...defaultCharacters, ...userCreatedCharacters];

    // Update localStorage with merged data
    if (checkStorageQuota()) {
      localStorage.setItem(KEYS.CHARACTERS, JSON.stringify(merged));
    }

    return merged;
  },

  getCharacterProfile: (id: string): CharacterProfile | undefined => {
    if (!isValidId(id)) return undefined;
    const profiles = storageService.getCharacterProfiles();
    return profiles.find(p => p.id === id);
  },

  saveCharacterProfile: (profile: CharacterProfile): boolean => {
    // Validate ID
    if (!profile || !isValidId(profile.id)) {
      console.warn('Invalid character profile ID');
      return false;
    }
    if (!checkStorageQuota()) return false;

    // Sanitize and validate
    const sanitizedProfile: CharacterProfile = {
      ...profile,
      id: profile.id, // Keep original ID
      name: sanitizeString(profile.name, SECURITY_CONFIG.MAX_NAME_LENGTH),
      persona: sanitizeString(profile.persona, SECURITY_CONFIG.MAX_PERSONA_LENGTH),
      voiceName: sanitizeString(profile.voiceName, SECURITY_CONFIG.MAX_NAME_LENGTH),
      avatarUrl: isValidDataUrl(profile.avatarUrl) ? profile.avatarUrl : SEED_CHARACTERS[0].avatarUrl,
      pitch: typeof profile.pitch === 'number' ? Math.max(0.5, Math.min(2, profile.pitch)) : 1.0,
      isDefault: profile.isDefault === true
    };

    const profiles = storageService.getCharacterProfiles();
    const index = profiles.findIndex(p => p.id === profile.id);

    let updated;
    if (index >= 0) {
      // Update existing
      updated = [...profiles];
      updated[index] = sanitizedProfile;
    } else {
      // Check count limit for new profiles
      if (profiles.length >= SECURITY_CONFIG.MAX_CHARACTERS_COUNT) {
        console.warn('Character storage limit reached');
        return false;
      }
      updated = [...profiles, sanitizedProfile];
    }
    localStorage.setItem(KEYS.CHARACTERS, JSON.stringify(updated));
    return true;
  },

  deleteCharacterProfile: (id: string): void => {
    if (!isValidId(id)) return;
    // Prevent deletion of default characters
    const profile = storageService.getCharacterProfile(id);
    if (profile?.isDefault) {
      console.warn('Cannot delete default character');
      return;
    }
    const profiles = storageService.getCharacterProfiles().filter(p => p.id !== id);
    localStorage.setItem(KEYS.CHARACTERS, JSON.stringify(profiles));
  },

  // --- Persona Config (with validation) ---
  getPersonaConfig: (): PersonaConfig => {
    const data = localStorage.getItem(KEYS.PERSONA_CONFIG);
    const parsed = safeJsonParse<PersonaConfig>(data, DEFAULT_PERSONA_CONFIG);
    // Validate IDs
    if (!isValidId(parsed.moderatorId) || !isValidId(parsed.commentatorId)) {
      return DEFAULT_PERSONA_CONFIG;
    }
    return parsed;
  },

  savePersonaConfig: (config: PersonaConfig): boolean => {
    // Validate IDs
    if (!config || !isValidId(config.moderatorId) || !isValidId(config.commentatorId)) {
      console.warn('Invalid persona config');
      return false;
    }
    if (!checkStorageQuota()) return false;
    localStorage.setItem(KEYS.PERSONA_CONFIG, JSON.stringify({
      moderatorId: config.moderatorId,
      commentatorId: config.commentatorId
    }));
    return true;
  },

  // --- Logic Helpers (with validation) ---
  getRotationHistory: (): string[] => {
    const data = localStorage.getItem(KEYS.HISTORY);
    const parsed = safeJsonParse<string[]>(data, []);
    // Filter out invalid IDs
    return parsed.filter(id => isValidId(id)).slice(0, 50);
  },

  // --- Conversations (会話履歴保存・再生) ---
  getConversations: (): SavedConversation[] => {
    const data = localStorage.getItem(KEYS.CONVERSATIONS);
    const parsed = safeJsonParse<SavedConversation[]>(data, []);
    return parsed.filter(c => c && isValidId(c.id)).sort((a, b) => b.createdAt - a.createdAt);
  },

  saveConversation: (conversation: SavedConversation): boolean => {
    if (!conversation || !isValidId(conversation.id)) {
      console.warn('Invalid conversation');
      return false;
    }
    if (!checkStorageQuota()) return false;

    const sanitizedConversation: SavedConversation = {
      id: conversation.id,
      questionText: sanitizeString(conversation.questionText, SECURITY_CONFIG.MAX_QUESTION_LENGTH),
      messages: conversation.messages.slice(0, 100).map(msg => ({
        id: msg.id,
        role: msg.role,
        text: sanitizeString(msg.text, 2000),
        timestamp: msg.timestamp,
        emotion: msg.emotion
      })),
      moderatorId: conversation.moderatorId,
      commentatorId: conversation.commentatorId,
      createdAt: conversation.createdAt
    };

    const conversations = storageService.getConversations();
    const existing = conversations.findIndex(c => c.id === conversation.id);

    let updated: SavedConversation[];
    if (existing >= 0) {
      updated = conversations.map(c => c.id === conversation.id ? sanitizedConversation : c);
    } else {
      // 最大件数を超えたら古いものを削除
      if (conversations.length >= SECURITY_CONFIG.MAX_CONVERSATIONS_COUNT) {
        updated = [sanitizedConversation, ...conversations.slice(0, SECURITY_CONFIG.MAX_CONVERSATIONS_COUNT - 1)];
      } else {
        updated = [sanitizedConversation, ...conversations];
      }
    }

    localStorage.setItem(KEYS.CONVERSATIONS, JSON.stringify(updated));
    return true;
  },

  getConversation: (id: string): SavedConversation | undefined => {
    if (!isValidId(id)) return undefined;
    return storageService.getConversations().find(c => c.id === id);
  },

  deleteConversation: (id: string): void => {
    if (!isValidId(id)) return;
    const conversations = storageService.getConversations().filter(c => c.id !== id);
    localStorage.setItem(KEYS.CONVERSATIONS, JSON.stringify(conversations));
  },

  // --- Consultation Sessions ---
  getConsultSessions: (): ConsultSession[] => {
    const data = localStorage.getItem(KEYS.CONSULT_SESSIONS);
    const parsed = safeJsonParse<ConsultSession[]>(data, []);
    return parsed.filter(s => s && isValidId(s.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  saveConsultSession: (session: ConsultSession): void => {
    if (!session || !isValidId(session.id)) return;
    if (!checkStorageQuota()) return;

    const sanitized: ConsultSession = {
      ...session,
      messages: session.messages.slice(0, SECURITY_CONFIG.MAX_CONSULT_MESSAGES).map(m => ({
        ...m,
        text: sanitizeString(m.text, SECURITY_CONFIG.MAX_CONCERN_LENGTH),
      })),
      themes: (session.themes || []).slice(0, 20).map(t => sanitizeString(t, SECURITY_CONFIG.MAX_TAG_LENGTH)),
      summary: session.summary ? sanitizeString(session.summary, 500) : undefined,
    };

    const sessions = storageService.getConsultSessions();
    const index = sessions.findIndex(s => s.id === session.id);
    let updated: ConsultSession[];
    if (index >= 0) {
      updated = [...sessions];
      updated[index] = sanitized;
    } else {
      updated = [sanitized, ...sessions].slice(0, SECURITY_CONFIG.MAX_CONSULT_SESSIONS);
    }
    localStorage.setItem(KEYS.CONSULT_SESSIONS, JSON.stringify(updated));
  },

  getConsultSession: (id: string): ConsultSession | undefined => {
    if (!isValidId(id)) return undefined;
    return storageService.getConsultSessions().find(s => s.id === id);
  },

  deleteConsultSession: (id: string): void => {
    if (!isValidId(id)) return;
    const sessions = storageService.getConsultSessions().filter(s => s.id !== id);
    localStorage.setItem(KEYS.CONSULT_SESSIONS, JSON.stringify(sessions));
  },

  // --- User Interest Profile ---
  getUserProfile: (): UserInterestProfile => {
    const data = localStorage.getItem(KEYS.USER_PROFILE);
    return safeJsonParse<UserInterestProfile>(data, {
      themes: {},
      recentConcerns: [],
      totalConsultations: 0,
      totalQuestionsGenerated: 0,
      totalSessionsCompleted: 0,
      lastUpdatedAt: Date.now(),
    });
  },

  updateUserProfile: (updates: Partial<UserInterestProfile>): void => {
    if (!checkStorageQuota()) return;
    const profile = storageService.getUserProfile();
    const updated = { ...profile, ...updates, lastUpdatedAt: Date.now() };
    localStorage.setItem(KEYS.USER_PROFILE, JSON.stringify(updated));
  },

  incrementTheme: (theme: string): void => {
    if (!theme) return;
    if (!checkStorageQuota()) return;
    const profile = storageService.getUserProfile();
    const safeTheme = sanitizeString(theme, SECURITY_CONFIG.MAX_TAG_LENGTH);
    profile.themes[safeTheme] = (profile.themes[safeTheme] || 0) + 1;
    profile.lastUpdatedAt = Date.now();
    localStorage.setItem(KEYS.USER_PROFILE, JSON.stringify(profile));
  },

  // --- Activity Log ---
  getActivityLog: (): ActivityLogEntry[] => {
    const data = localStorage.getItem(KEYS.ACTIVITY_LOG);
    return safeJsonParse<ActivityLogEntry[]>(data, []);
  },

  addActivityLog: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>): void => {
    if (!checkStorageQuota()) return;
    const log = storageService.getActivityLog();
    const newEntry: ActivityLogEntry = {
      ...entry,
      detail: sanitizeString(entry.detail || '', 500),
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    const updated = [newEntry, ...log].slice(0, SECURITY_CONFIG.MAX_ACTIVITY_LOG_ENTRIES);
    localStorage.setItem(KEYS.ACTIVITY_LOG, JSON.stringify(updated));
  },

  // Clear all with confirmation (returns cleared status)
  clearAll: (): boolean => {
    try {
      localStorage.clear();
      return true;
    } catch {
      console.error('Failed to clear storage');
      return false;
    }
  }
};
