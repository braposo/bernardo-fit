import { randomUUID } from "node:crypto";
import { contentStatus, CONTENT_TYPES, listContent, readContent } from "../lib/sanity/content.js";

try {
  const status = await contentStatus();
  // Exercise the app's list projection as well as aggregate connectivity.
  for (const type of CONTENT_TYPES) await listContent(type);
  // Validate each detail projection without creating test documents.
  const missingId = `connection-check-${randomUUID()}`;
  for (const type of ["candidateProfile", "job", "companyResearch"]) {
    if (await readContent(type, missingId)) throw new Error("Unexpected check document.");
  }
  console.log(JSON.stringify(status, null, 2));
} catch (error) {
  console.error(error.code === "SANITY_NOT_CONFIGURED" ? error.message : "Sanity connection check failed. Verify the viewer token and network access.");
  process.exitCode = 1;
}
