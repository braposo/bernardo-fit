import { loadAnalysisSettings, withSettingsSnapshot, settingsFingerprint } from "../lib/sanity/analysis-settings.js";
import { scoringInput, scoringQuestions } from "../lib/jev-scoring.js";
import { buildSystemPrompt } from "../lib/profile.js";

try {
  // Fetch and build actual task inputs, without a paid model call or content write.
  const snapshot = await loadAnalysisSettings({...process.env, SANITY_ANALYSIS_ENABLED: "1"});
  withSettingsSnapshot(snapshot, () => {
    const prompt = buildSystemPrompt();
    const questions = scoringQuestions();
    const state = scoringInput({});
    if (!prompt.stable || !state.candidate || Object.keys(questions).length !== 12) throw Error("Invalid task inputs");
    console.log(JSON.stringify({source: "sanity", revision: snapshot.revision,
      fingerprint: settingsFingerprint(), prompts: Object.keys(snapshot.texts).length,
      jevQuestions: Object.keys(snapshot.questions).length, generationReady: true}, null, 2));
  });
} catch (error) {
  console.error(String(error.code || "").startsWith("SANITY_SETTINGS_") ? error.message : "Analysis settings check failed.");
  process.exitCode = 1;
}
