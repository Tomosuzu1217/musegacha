import { firestoreService } from './firestoreService';

// Keys matching storageService localStorage keys
const KEYS = {
  QUESTIONS: 'musegacha_questions',
  ANSWERS: 'musegacha_answers',
  HISTORY: 'musegacha_history_ids',
  IMAGES: 'musegacha_images',
  PERSONA_CONFIG: 'musegacha_persona_config_v2',
  CHARACTERS: 'musegacha_characters',
  CONVERSATIONS: 'musegacha_conversations',
  CONSULT_SESSIONS: 'musegacha_consult_sessions',
  USER_PROFILE: 'musegacha_user_profile',
  ACTIVITY_LOG: 'musegacha_activity_log',
  CORE_INSIGHTS: 'musegacha_core_insights',
};

const safeParse = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/**
 * Migrate localStorage data to Firestore on first Google Sign-In.
 * Idempotent: checks migration flag before running.
 */
export const migrateLocalStorageIfNeeded = async (uid: string): Promise<void> => {
  // Check if already migrated
  const alreadyMigrated = await firestoreService.getMigrationStatus(uid);
  if (alreadyMigrated) return;

  // Check if there is any local data worth migrating
  const hasLocalData = localStorage.getItem(KEYS.QUESTIONS) !== null
    || localStorage.getItem(KEYS.ANSWERS) !== null
    || localStorage.getItem(KEYS.CONSULT_SESSIONS) !== null;

  if (!hasLocalData) {
    await firestoreService.setMigrationDone(uid, false);
    return;
  }

  // Read all localStorage data
  const questions = safeParse<any[]>(KEYS.QUESTIONS, []);
  const answers = safeParse<any[]>(KEYS.ANSWERS, []);
  const images = safeParse<any[]>(KEYS.IMAGES, []);
  const characters = safeParse<any[]>(KEYS.CHARACTERS, []);
  const conversations = safeParse<any[]>(KEYS.CONVERSATIONS, []);
  const consultSessions = safeParse<any[]>(KEYS.CONSULT_SESSIONS, []);
  const activityLog = safeParse<any[]>(KEYS.ACTIVITY_LOG, []);
  const rotationHistory = safeParse<string[]>(KEYS.HISTORY, []);
  const userProfile = safeParse<any>(KEYS.USER_PROFILE, null);
  const personaConfig = safeParse<any>(KEYS.PERSONA_CONFIG, null);
  const coreInsights = safeParse<any>(KEYS.CORE_INSIGHTS, null);

  // Batch write collections
  await firestoreService.batchSetAll(uid, {
    questions: questions.filter((q: any) => q && q.id),
    answers: answers.filter((a: any) => a && a.id),
    images: images.filter((i: any) => i && i.id),
    characters: characters.filter((c: any) => c && c.id),
    conversations: conversations.filter((c: any) => c && c.id),
    consultSessions: consultSessions.filter((s: any) => s && s.id),
    activityLog: activityLog.filter((e: any) => e && e.id),
  });

  // Write config documents
  if (rotationHistory.length > 0) {
    await firestoreService.setRotationHistory(uid, rotationHistory);
  }
  if (userProfile) {
    await firestoreService.setProfile(uid, userProfile);
  }
  if (personaConfig) {
    await firestoreService.setPersonaConfig(uid, personaConfig);
  }
  if (coreInsights) {
    await firestoreService.setCoreInsights(uid, coreInsights);
  }

  // Mark migration complete
  await firestoreService.setMigrationDone(uid, true, {
    questions: questions.length,
    answers: answers.length,
    characters: characters.length,
    consultSessions: consultSessions.length,
  });
};
