import { CanvasLogo } from "@/components/canvas-logo";
import { Link, createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root";

export const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/privacy",
  component: PrivacyPage,
});

// Content reflects what this codebase's schema/routers actually store and
// send to third parties (see DATA_MODEL.md, ARCHITECTURE.md §3, and the
// Copywriter/Brain/Generate AI paths) — not generic boilerplate. Still a
// draft: it hasn't been reviewed by a lawyer, and jurisdiction-specific
// requirements (GDPR/CCPA specifics, a real governing-law clause) need
// that review before this is relied on as a binding policy.
function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center gap-3">
        <CanvasLogo size={40} />
        <Link to="/" className="text-foreground text-sm font-semibold">
          Canvas
        </Link>
      </div>

      <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="privacy-page">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground text-xs">Last updated: 2026-07-29</p>

        <p className="rounded-md border border-dashed p-3 text-xs">
          <strong>Draft notice:</strong> this policy describes what this Service actually collects
          and does, generated directly from its codebase — it has not been reviewed by a lawyer.
          Review it with qualified legal counsel for your jurisdiction before relying on it as a
          binding policy.
        </p>

        <p>
          This Privacy Policy explains what information Canvas ("the Service") collects, how it's
          used, and the choices available to you.
        </p>

        <h2>Information We Collect</h2>
        <p>
          <strong>Account information:</strong> your name, email address, and (for email/password
          accounts) a securely hashed password. If you sign in with Google, we store the
          name/email/profile picture Google provides.
        </p>
        <p>
          <strong>Content you create:</strong> tasks, docs, comments, images you upload or generate,
          and anything else you add to a workspace, including:
        </p>
        <ul>
          <li>
            Uploaded files and images, and images generated through Generate, Brain, or Copywriter.
          </li>
          <li>
            AI chat conversation history (Brain) and AI-generated copy (Copywriter), including any
            images or files attached as reference.
          </li>
          <li>Comments, reactions, and workspace activity history.</li>
        </ul>
        <p>
          <strong>Usage &amp; account data:</strong> which AI features you use and how often (to
          enforce usage limits and estimate cost), session/login activity, and workspace activity
          logs.
        </p>
        <p>
          <strong>Cookies:</strong> a single session cookie keeps you signed in. It is not used for
          advertising or cross-site tracking.
        </p>

        <h2>How We Use Information</h2>
        <ul>
          <li>
            To operate the Service — showing your workspaces, tasks, docs, and files back to you and
            your teammates.
          </li>
          <li>
            To provide AI features — prompts, uploaded images, and conversation context are sent to
            a configured AI provider to generate responses, images, and copy (see below).
          </li>
          <li>To enforce usage limits and calculate estimated AI cost.</li>
          <li>To send notifications and, if configured, email digests.</li>
          <li>To maintain security — rate-limiting, audit logging, and abuse prevention.</li>
        </ul>

        <h2>Third-Party AI Providers</h2>
        <p>
          Canvas's AI features (image generation, the Brain chat assistant, and Copywriter) work by
          sending your prompts, uploaded images, and relevant conversation context to a third-party
          AI provider. Depending on configuration, this may include:
        </p>
        <ul>
          <li>
            <strong>OpenAI</strong> — image generation (gpt-image-1) and chat (Responses API).
          </li>
          <li>
            <strong>Anthropic</strong> — Claude, used for chat and image understanding/critique.
          </li>
          <li>
            <strong>Google</strong> — Gemini as an alternative image provider, and Google OAuth
            sign-in.
          </li>
        </ul>
        <p>
          These providers process submitted content to generate their response; each has its own
          privacy policy governing how it handles that data. Canvas does not control, and is not
          responsible for, how these third parties process data beyond servicing the request.
        </p>

        <h2>Other Third-Party Integrations (opt-in)</h2>
        <p>
          If a workspace owner connects them, these integrations may share data with third parties
          as part of their normal function: Slack (notifications) and Google Drive (attaching
          files). These only activate if a workspace admin explicitly configures them.
        </p>

        <h2>Data Storage &amp; Security</h2>
        <ul>
          <li>Data is stored in a Postgres database and S3-compatible object storage.</li>
          <li>
            Passwords are hashed, never stored in plain text; sessions use httpOnly, secure cookies.
          </li>
          <li>Access to workspace data is governed by role-based permissions.</li>
          <li>We do not sell your personal information.</li>
        </ul>

        <h2>Data Retention &amp; Deletion</h2>
        <p>
          Deleted items (tasks, docs, images, and similar) are hidden from view immediately; some
          categories may be retained briefly for recovery/audit purposes before permanent removal.
          You can request deletion of your account and associated personal data — see "Your Rights"
          below.
        </p>

        <h2>Your Rights</h2>
        <p>
          Depending on your jurisdiction, you may have the right to access, correct, export, or
          delete your personal data. You can:
        </p>
        <ul>
          <li>Export your workspace's data from the Developer settings page.</li>
          <li>
            Request deletion of your account from your <Link to="/account">Account page</Link>, or
            by contacting a workspace admin/owner.
          </li>
        </ul>

        <h2>Children's Privacy</h2>
        <p>The Service is not directed at, and should not be used by, children under 16.</p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this policy as the Service changes. Material changes will be noted here with
          an updated "Last updated" date.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy should be directed to your workspace administrator or the
          organization operating this deployment.
        </p>

        <p className="text-muted-foreground text-xs">
          See also the <Link to="/terms">Terms of Service</Link>.
        </p>
      </div>
    </main>
  );
}
