import { requireAdmin, makeViewToken, verifyViewToken } from '../admin.js';
import { getJob } from '../store.js';
import { getApplicationCv, getApplicationCvVersion, listApplicationCvVersions,
  publishApplicationCvVersion, applicationCvPdfUrl } from '../application-cv-store.js';
import { renderApplicationCvHtml } from '../application-cv-render.js';
import { withApplicationCvFields } from '../application-cv-view.js';
import { appendAudit, auditEvent } from '../job-audit.js';

const tokenScope = (jobId, versionId) => `cv:${jobId}:${versionId}`;
const error = (message, status = 400) => Object.assign(new Error(message), { status });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const id = String(req.query?.id || req.body?.id || '');
    const versionId = String(req.query?.version || req.body?.versionId || '');
    const signedRead = req.method === 'GET' && ['preview', 'download'].includes(req.query?.action)
      && verifyViewToken(tokenScope(id, versionId), req.query?.token);
    if (!signedRead && !requireAdmin(req, res)) return;
    if (!id) throw error('Missing job id');
    const job = await getJob(id);
    if (!job) throw error('Job not found', 404);
    const application = await getApplicationCv(id);
    if (req.method === 'GET') {
      if (versionId) {
        const version = await getApplicationCvVersion(id, versionId);
        if (!version) throw error('CV version not found', 404);
        if (req.query?.action === 'download') {
          const url = applicationCvPdfUrl(version, { download: true });
          if (!url) throw error('This version has no validated PDF yet.', 409);
          res.setHeader('Location', url);
          return res.status(302).end();
        }
        if (req.query?.action === 'preview') {
          if (!version.content) throw error('CV content is unavailable.', 409);
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; frame-ancestors 'self'");
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.status(200).send(await renderApplicationCvHtml(version.content, {
            minBodyPx: version.sourceSnapshot?.settings?.minBodyPx,
          }));
        }
        return res.status(200).json({ version, content: version.content });
      }
      const versions = await listApplicationCvVersions(id);
      return res.status(200).json({ application, versions: versions.map(version => ({
        id: version.id, versionId: version.id, vid: version.id, createdAt: version.createdAt, at: version.createdAt,
        model: version.model, validation: version.validation, active: version.id === application?.currentVersionId,
        hasPdf: version.validation?.status === 'valid' && !!version.pdfSha256,
        submitted: version.id === application?.submittedVersionId, versionInstructions: version.versionInstructions || '',
      })) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!versionId) throw error('Choose a CV version');
    const version = await getApplicationCvVersion(id, versionId);
    if (!version) throw error('CV version not found', 404);
    if (req.body.action === 'view-token') {
      const token = makeViewToken(tokenScope(id, versionId));
      const base = `/api/admin/cv?id=${encodeURIComponent(id)}&version=${encodeURIComponent(versionId)}&token=${encodeURIComponent(token)}`;
      return res.status(200).json({ previewUrl: `${base}&action=preview`,
        downloadUrl: applicationCvPdfUrl(version) ? `${base}&action=download` : '' });
    }
    if (req.body.action === 'publish') {
      if (job.archived) throw error('Restore this role before publishing a CV.', 409);
      await publishApplicationCvVersion(id, versionId, {
        expectedRequestId: application?.run?.requestId,
        expectedFingerprint: version.fingerprint,
        historical: true, allowAfterSubmission: true,
      });
      await appendAudit('job', id, auditEvent('cv.published', 'CV version published', '', { actor: 'admin' }));
      return res.status(200).json({ ok: true, job: await withApplicationCvFields(job) });
    }
    throw error('Unknown CV action');
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'The CV could not be loaded. Please try again.' });
  }
}
