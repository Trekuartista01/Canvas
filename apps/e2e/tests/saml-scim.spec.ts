import { expect, test } from "@playwright/test";
import { createWorkspaceAndOpen, signUp, uniqueEmail } from "./helpers";
import { buildSignedSamlResponse, TEST_IDP_CERT, TEST_IDP_ENTITY_ID } from "./saml-test-idp";

const API_ORIGIN = "http://localhost:3001";

test("Phase 6: SAML SSO configures an IdP, logs a new member in via a real signed assertion, and rejects a tampered one", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "SSO Owner");
  await createWorkspaceAndOpen(page, "SSO Workspace");
  const workspaceId = page.url().match(/\/w\/([^/?#]+)/)?.[1];
  if (!workspaceId) throw new Error("Could not read workspaceId from the URL");

  await page.getByRole("link", { name: "Security", exact: true }).click();
  await expect(page.getByTestId("security-page")).toBeVisible();

  await page.getByTestId("sso-idp-entity-id").fill(TEST_IDP_ENTITY_ID);
  await page.getByTestId("sso-idp-sso-url").fill("https://idp.test/sso");
  await page.getByTestId("sso-idp-certificate").fill(TEST_IDP_CERT);
  await page.getByTestId("sso-default-role").selectOption("member");
  const saved = page.waitForResponse((res) => res.url().includes("sso.upsert"));
  await page.getByTestId("sso-save").click();
  await saved;
  await expect(page.getByTestId("sso-login-url")).toBeVisible();

  // The SAML login itself happens in a separate browser context — a
  // different session/machine entirely, same as member-management.spec.ts's
  // bobContext — so it gets its own session cookie rather than overwriting
  // the workspace owner's, letting `page` keep verifying as the owner below.
  const ssoContext = await browser.newContext();

  // SP-initiated redirect: hit /login directly (no-follow) and confirm it
  // 302s to the configured IdP SSO URL with a real SAMLRequest param,
  // without needing idp.test to actually resolve.
  const loginResponse = await ssoContext.request.get(
    `${API_ORIGIN}/auth/saml/${workspaceId}/login`,
    {
      maxRedirects: 0,
    },
  );
  expect(loginResponse.status()).toBe(302);
  const redirectLocation = loginResponse.headers()["location"];
  expect(redirectLocation).toContain("https://idp.test/sso");
  expect(redirectLocation).toContain("SAMLRequest=");

  // The callback half: POST a real, signed SAMLResponse — proves the app's
  // actual XML signature verification (not a mock) accepts a genuine
  // assertion from the configured IdP cert and provisions a brand-new user.
  // Unique per run: a fixed address collides with the user a previous run
  // provisioned, which the SSO identity-conflict guard (rightly) rejects.
  const email = uniqueEmail("jane.doe");
  const displayName = email.split("@")[0]!;
  const validResponse = buildSignedSamlResponse({ workspaceId, email });
  const callbackResponse = await ssoContext.request.post(
    `${API_ORIGIN}/auth/saml/${workspaceId}/callback`,
    { form: { SAMLResponse: validResponse }, maxRedirects: 0 },
  );
  expect(callbackResponse.status()).toBe(302);
  expect(callbackResponse.headers()["location"]).toContain(`/w/${workspaceId}`);

  await page.goto(`/w/${workspaceId}`);
  await expect(page.getByText(displayName, { exact: true })).toBeVisible();
  await expect(page.getByLabel(`Role for ${displayName}`)).toHaveValue("member");

  // Logging in again with the same email must not create a second
  // membership/user — find-or-create, not always-create.
  const secondResponse = buildSignedSamlResponse({ workspaceId, email });
  const secondCallback = await ssoContext.request.post(
    `${API_ORIGIN}/auth/saml/${workspaceId}/callback`,
    { form: { SAMLResponse: secondResponse }, maxRedirects: 0 },
  );
  expect(secondCallback.status()).toBe(302);
  await page.goto(`/w/${workspaceId}`);
  await expect(page.getByText(displayName, { exact: true })).toHaveCount(1);

  // A tampered signature must be rejected, not silently accepted.
  const tampered = validResponse.slice(0, -10) + "AAAAAAAAAA";
  const tamperedCallback = await ssoContext.request.post(
    `${API_ORIGIN}/auth/saml/${workspaceId}/callback`,
    { form: { SAMLResponse: tampered }, maxRedirects: 0 },
  );
  expect(tamperedCallback.status()).toBe(302);
  expect(tamperedCallback.headers()["location"]).toContain("error=sso_failed");

  await ssoContext.close();
});

test("Phase 6: SCIM provisions and deprovisions a workspace member over the standard REST API", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "SCIM Owner");
  await createWorkspaceAndOpen(page, "SCIM Workspace");
  const workspaceId = page.url().match(/\/w\/([^/?#]+)/)?.[1];
  if (!workspaceId) throw new Error("Could not read workspaceId from the URL");

  await page.getByRole("link", { name: "Security", exact: true }).click();
  await expect(page.getByTestId("security-page")).toBeVisible();
  await page.getByTestId("scim-token-new-name").fill("Okta");
  const tokenCreated = page.waitForResponse((res) => res.url().includes("scimToken.create"));
  await page.getByTestId("scim-token-create").click();
  await tokenCreated;
  const scimToken = await page.getByTestId("revealed-scim-token").locator("input").inputValue();
  expect(scimToken).toMatch(/^cnv_scim_[0-9a-f]{48}$/);

  const scimBase = `${API_ORIGIN}/scim/v2/${workspaceId}`;
  const authHeaders = { Authorization: `Bearer ${scimToken}` };

  // An invalid token is rejected.
  const unauthorized = await page.context().request.get(`${scimBase}/Users`, {
    headers: { Authorization: "Bearer cnv_scim_not_real" },
  });
  expect(unauthorized.status()).toBe(401);

  // Provision a new user (unique per run, so a rerun against the same
  // database doesn't 409 on the user the previous run created).
  const carlosEmail = uniqueEmail("carlos");
  const createRes = await page.context().request.post(`${scimBase}/Users`, {
    headers: authHeaders,
    data: { userName: carlosEmail, name: { formatted: "Carlos Diaz" } },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: string; userName: string; active: boolean };
  expect(created.userName).toBe(carlosEmail);
  expect(created.active).toBe(true);

  // Shows up in the real workspace UI, just like a manually-invited member.
  await page.goto(`/w/${workspaceId}`);
  await expect(page.getByText("Carlos Diaz")).toBeVisible();
  await expect(page.getByLabel("Role for Carlos Diaz")).toHaveValue("member");

  // The IdP's own "does this user already exist" check.
  const filtered = await page
    .context()
    .request.get(`${scimBase}/Users?filter=${encodeURIComponent(`userName eq "${carlosEmail}"`)}`, {
      headers: authHeaders,
    });
  expect(filtered.status()).toBe(200);
  const filteredBody = (await filtered.json()) as { totalResults: number };
  expect(filteredBody.totalResults).toBe(1);

  // Deactivate via PATCH (the shape Okta/Azure AD actually send) — removes
  // the membership, same as a manual admin removal.
  const patchRes = await page.context().request.patch(`${scimBase}/Users/${created.id}`, {
    headers: authHeaders,
    data: { Operations: [{ op: "replace", path: "active", value: false }] },
  });
  expect(patchRes.status()).toBe(204);

  await page.goto(`/w/${workspaceId}`);
  await expect(page.getByText("Carlos Diaz")).toHaveCount(0);
});
