import { db } from './firebaseConfig';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import type {
  Question,
  Answer,
  StoredImage,
  CharacterProfile,
  SavedConversation,
  ConsultSession,
  ActivityLogEntry,
  UserInterestProfile,
  PersonaConfig,
  CoreInsights,
} from '../types';

// Helper: collection path under user
const userCol = (uid: string, col: string) => collection(db, `users/${uid}/${col}`);
const userDoc = (uid: string, col: string, id: string) => doc(db, `users/${uid}/${col}/${id}`);
const configDoc = (uid: string, key: string) => doc(db, `users/${uid}/config/${key}`);

// Helper: batch write with 450-item chunks
const batchWrite = async (
  items: Array<{ ref: ReturnType<typeof doc>; data: any }>
) => {
  const BATCH_SIZE = 450;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = items.slice(i, i + BATCH_SIZE);
    for (const item of chunk) {
      batch.set(item.ref, item.data);
    }
    await batch.commit();
  }
};

// Helper: load all docs from a collection
const loadCollection = async <T>(uid: string, colName: string): Promise<T[]> => {
  const snapshot = await getDocs(userCol(uid, colName));
  return snapshot.docs.map(d => d.data() as T);
};

// Helper: load a single config document
const loadConfig = async <T>(uid: string, key: string): Promise<T | null> => {
  const snap = await getDoc(configDoc(uid, key));
  return snap.exists() ? (snap.data() as T) : null;
};

export const firestoreService = {
  // === Bulk Loaders (for initialization) ===
  loadAllQuestions: (uid: string) => loadCollection<Question>(uid, 'questions'),
  loadAllAnswers: (uid: string) => loadCollection<Answer>(uid, 'answers'),
  loadAllImages: (uid: string) => loadCollection<StoredImage>(uid, 'images'),
  loadAllCharacters: (uid: string) => loadCollection<CharacterProfile>(uid, 'characters'),
  loadAllConversations: (uid: string) => loadCollection<SavedConversation>(uid, 'conversations'),
  loadAllConsultSessions: (uid: string) => loadCollection<ConsultSession>(uid, 'consultSessions'),
  loadAllActivityLog: (uid: string) => loadCollection<ActivityLogEntry>(uid, 'activityLog'),

  // === Config Loaders ===
  getProfile: (uid: string) => loadConfig<UserInterestProfile>(uid, 'profile'),
  getPersonaConfig: (uid: string) => loadConfig<PersonaConfig>(uid, 'personaConfig'),
  getCoreInsights: (uid: string) => loadConfig<CoreInsights>(uid, 'coreInsights'),
  getRotationHistory: async (uid: string): Promise<string[]> => {
    const data = await loadConfig<{ ids: string[] }>(uid, 'rotationHistory');
    return data?.ids || [];
  },
  getMigrationStatus: async (uid: string): Promise<boolean> => {
    const snap = await getDoc(configDoc(uid, 'migration'));
    return snap.exists();
  },

  // === Single Document Writers ===
  setQuestion: (uid: string, q: Question) =>
    setDoc(userDoc(uid, 'questions', q.id), q),

  deleteQuestion: (uid: string, id: string) =>
    deleteDoc(userDoc(uid, 'questions', id)),

  setAnswer: (uid: string, a: Answer) =>
    setDoc(userDoc(uid, 'answers', a.id), a),

  setImage: (uid: string, img: StoredImage) =>
    setDoc(userDoc(uid, 'images', img.id), img),

  deleteImage: (uid: string, id: string) =>
    deleteDoc(userDoc(uid, 'images', id)),

  setCharacter: (uid: string, c: CharacterProfile) =>
    setDoc(userDoc(uid, 'characters', c.id), c),

  deleteCharacter: (uid: string, id: string) =>
    deleteDoc(userDoc(uid, 'characters', id)),

  setConversation: (uid: string, c: SavedConversation) =>
    setDoc(userDoc(uid, 'conversations', c.id), c),

  deleteConversation: (uid: string, id: string) =>
    deleteDoc(userDoc(uid, 'conversations', id)),

  setConsultSession: (uid: string, s: ConsultSession) =>
    setDoc(userDoc(uid, 'consultSessions', s.id), s),

  deleteConsultSession: (uid: string, id: string) =>
    deleteDoc(userDoc(uid, 'consultSessions', id)),

  addActivityLogEntry: (uid: string, entry: ActivityLogEntry) =>
    setDoc(userDoc(uid, 'activityLog', entry.id), entry),

  // === Config Writers ===
  setProfile: (uid: string, profile: UserInterestProfile) =>
    setDoc(configDoc(uid, 'profile'), profile),

  setPersonaConfig: (uid: string, config: PersonaConfig) =>
    setDoc(configDoc(uid, 'personaConfig'), config),

  setCoreInsights: (uid: string, insights: CoreInsights) =>
    setDoc(configDoc(uid, 'coreInsights'), insights),

  setRotationHistory: (uid: string, ids: string[]) =>
    setDoc(configDoc(uid, 'rotationHistory'), { ids }),

  setMigrationDone: (uid: string, hadLocalData: boolean, counts?: Record<string, number>) =>
    setDoc(configDoc(uid, 'migration'), {
      migratedAt: Date.now(),
      hadLocalData,
      ...(counts ? { itemCounts: counts } : {}),
    }),

  // === Batch Writers (for seeding/migration) ===
  batchSetQuestions: async (uid: string, questions: Question[]) => {
    await batchWrite(
      questions.map(q => ({ ref: userDoc(uid, 'questions', q.id), data: q }))
    );
  },

  batchSetCharacters: async (uid: string, characters: CharacterProfile[]) => {
    await batchWrite(
      characters.map(c => ({ ref: userDoc(uid, 'characters', c.id), data: c }))
    );
  },

  batchSetAll: async (
    uid: string,
    data: {
      questions?: Question[];
      answers?: Answer[];
      images?: StoredImage[];
      characters?: CharacterProfile[];
      conversations?: SavedConversation[];
      consultSessions?: ConsultSession[];
      activityLog?: ActivityLogEntry[];
    }
  ) => {
    const items: Array<{ ref: ReturnType<typeof doc>; data: any }> = [];

    if (data.questions) {
      for (const q of data.questions) {
        items.push({ ref: userDoc(uid, 'questions', q.id), data: q });
      }
    }
    if (data.answers) {
      for (const a of data.answers) {
        items.push({ ref: userDoc(uid, 'answers', a.id), data: a });
      }
    }
    if (data.images) {
      for (const img of data.images) {
        items.push({ ref: userDoc(uid, 'images', img.id), data: img });
      }
    }
    if (data.characters) {
      for (const c of data.characters) {
        items.push({ ref: userDoc(uid, 'characters', c.id), data: c });
      }
    }
    if (data.conversations) {
      for (const c of data.conversations) {
        items.push({ ref: userDoc(uid, 'conversations', c.id), data: c });
      }
    }
    if (data.consultSessions) {
      for (const s of data.consultSessions) {
        items.push({ ref: userDoc(uid, 'consultSessions', s.id), data: s });
      }
    }
    if (data.activityLog) {
      for (const e of data.activityLog) {
        items.push({ ref: userDoc(uid, 'activityLog', e.id), data: e });
      }
    }

    await batchWrite(items);
  },
};
