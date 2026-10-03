// Turns a stored analysis error into something a user can act on. Pure, so it can be unit-tested.

export type FailureKind = 'NO_TEXT' | 'AI_UNAVAILABLE' | 'AI_CONFIGURATION' | 'AI_INVALID_ANSWER' | 'AI_REFUSED' | 'UNKNOWN';
export type ReportFailure = { kind: FailureKind; message: string; retryable: boolean; retryHint: string | null };

const MESSAGE: Record<FailureKind, string> = {
  NO_TEXT: 'Aucun texte exploitable n’a pu être extrait de ce PDF (document scanné, protégé ou vide).',
  AI_UNAVAILABLE: 'Le service d’analyse IA était indisponible ou surchargé au moment de l’analyse.',
  AI_CONFIGURATION: 'L’analyse IA n’a pas pu démarrer : la configuration du service (clé ou modèle) est incorrecte.',
  AI_INVALID_ANSWER: 'L’IA a renvoyé une réponse incomplète ou invalide, qui n’a pas été enregistrée.',
  AI_REFUSED: 'L’IA a refusé d’analyser ce contenu.',
  UNKNOWN: 'L’analyse a échoué pour une raison technique.',
};

export function failureKind(error: string | null | undefined, hasText: boolean): FailureKind {
  const e = (error || '').toLowerCase();
  if (!hasText || e.includes('aucun texte exploitable') || e.includes('invalid pdf') || e.includes('text extraction')) return 'NO_TEXT';
  if (/\b(503|529|502|504)\b|unavailable|overloaded|high demand|indisponible|limite de débit|rate limit|\b429\b|timeout|impossible de joindre/.test(e)) return 'AI_UNAVAILABLE';
  if (/clé api|api key|not configured|invalide ou révoquée|\b401\b|\b403\b|modèle anthropic introuvable|n'a pas accès/.test(e)) return 'AI_CONFIGURATION';
  if (/réponse ia invalide|not valid json|tronquée/.test(e)) return 'AI_INVALID_ANSWER';
  if (/a refusé/.test(e)) return 'AI_REFUSED';
  return 'UNKNOWN';
}

// hasText: the PDF text was extracted and is stored. aiConfigured: an AI key is present now.
export function describeFailure(error: string | null | undefined, hasText: boolean, aiConfigured: boolean): ReportFailure {
  const kind = failureKind(error, hasText);
  if (kind === 'NO_TEXT') return { kind, message: MESSAGE[kind], retryable: false, retryHint: 'Relancer l’analyse ne changera rien : importez une version du PDF contenant du texte.' };
  if (!aiConfigured) return { kind, message: MESSAGE[kind], retryable: false, retryHint: 'L’analyse IA n’est pas configurée sur ce serveur.' };
  const hint = kind === 'AI_CONFIGURATION' ? 'Si la configuration a été corrigée depuis, vous pouvez relancer l’analyse.' : 'Le texte du PDF est conservé : vous pouvez relancer l’analyse.';
  return { kind, message: MESSAGE[kind], retryable: true, retryHint: hint };
}
