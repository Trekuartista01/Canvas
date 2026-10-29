import { describe, expect, it } from "vitest";
import { can, isGrantable } from "./can";
import type { SessionUser } from "./session";

const user: SessionUser = {
  id: "u1",
  email: "a@example.com",
  name: "A",
  avatarUrl: null,
  bio: null,
  title: null,
};

describe("can", () => {
  it("denies non-members", () => {
    expect(can(user, "workspace:invite", { type: "workspace", role: null })).toBe(false);
  });

  it("denies members from inviting", () => {
    expect(can(user, "workspace:invite", { type: "workspace", role: "member" })).toBe(false);
  });

  it("allows admins to invite", () => {
    expect(can(user, "workspace:invite", { type: "workspace", role: "admin" })).toBe(true);
  });

  it("allows owners to invite", () => {
    expect(can(user, "workspace:invite", { type: "workspace", role: "owner" })).toBe(true);
  });

  it("only allows admins+ to manage members (role changes, removal)", () => {
    expect(can(user, "workspace:manage", { type: "workspace", role: "member" })).toBe(false);
    expect(can(user, "workspace:manage", { type: "workspace", role: "admin" })).toBe(true);
    expect(can(user, "workspace:manage", { type: "workspace", role: "owner" })).toBe(true);
  });

  it("only allows owners to delete the workspace", () => {
    expect(can(user, "workspace:delete", { type: "workspace", role: "admin" })).toBe(false);
    expect(can(user, "workspace:delete", { type: "workspace", role: "owner" })).toBe(true);
  });

  it("allows any member (including guests) to view the hierarchy", () => {
    expect(can(user, "hierarchy:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "hierarchy:view", { type: "workspace", role: "owner" })).toBe(true);
    expect(can(user, "hierarchy:view", { type: "workspace", role: null })).toBe(false);
  });

  it("denies guests from creating spaces/folders/lists, allows members+", () => {
    expect(can(user, "hierarchy:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "hierarchy:create", { type: "workspace", role: "member" })).toBe(true);
  });

  it("only allows admins+ to delete spaces/folders/lists", () => {
    expect(can(user, "hierarchy:delete", { type: "workspace", role: "member" })).toBe(false);
    expect(can(user, "hierarchy:delete", { type: "workspace", role: "admin" })).toBe(true);
  });

  it("only allows admins+ to delete statuses, but members can create/update them", () => {
    expect(can(user, "status:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "status:create", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "status:delete", { type: "workspace", role: "member" })).toBe(false);
    expect(can(user, "status:delete", { type: "workspace", role: "admin" })).toBe(true);
  });

  it("allows members to fully manage tasks, including delete", () => {
    expect(can(user, "task:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "task:create", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "task:delete", { type: "workspace", role: "member" })).toBe(true);
  });

  it("allows guests to view and post comments, unlike creating tasks", () => {
    expect(can(user, "comment:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "comment:create", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "comment:create", { type: "workspace", role: null })).toBe(false);
  });

  it("only allows admins+ to delete tags, but members can create them", () => {
    expect(can(user, "tag:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "tag:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "tag:create", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "tag:delete", { type: "workspace", role: "member" })).toBe(false);
    expect(can(user, "tag:delete", { type: "workspace", role: "admin" })).toBe(true);
  });

  it("only allows admins+ to delete custom field defs, but members can create/update them and set values", () => {
    expect(can(user, "customFieldDef:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "customFieldDef:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "customFieldDef:create", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "customFieldDef:delete", { type: "workspace", role: "member" })).toBe(false);
    expect(can(user, "customFieldDef:delete", { type: "workspace", role: "admin" })).toBe(true);
    expect(can(user, "customFieldValue:update", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "customFieldValue:update", { type: "workspace", role: "guest" })).toBe(false);
  });

  it("allows guests to view attachments, but only members can upload/delete them", () => {
    expect(can(user, "attachment:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "attachment:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "attachment:create", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "attachment:delete", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "attachment:delete", { type: "workspace", role: "member" })).toBe(true);
  });

  it("allows guests to view image assets, but only members can generate/edit them", () => {
    expect(can(user, "imageAsset:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "imageAsset:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "imageAsset:create", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "imageAsset:delete", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "imageAsset:delete", { type: "workspace", role: "member" })).toBe(true);
  });

  it("allows guests to view Library folders, but only members can create/delete them", () => {
    expect(can(user, "imageFolder:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "imageFolder:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "imageFolder:create", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "imageFolder:delete", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "imageFolder:delete", { type: "workspace", role: "member" })).toBe(true);
  });

  it("allows guests to view saved Copywriter library items, but only members can delete them", () => {
    expect(can(user, "libraryCopyItem:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "libraryCopyItem:delete", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "libraryCopyItem:delete", { type: "workspace", role: "member" })).toBe(true);
  });

  it("allows guests to view Brain conversations, but only members can send chat messages", () => {
    expect(can(user, "brain:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "brain:chat", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "brain:chat", { type: "workspace", role: "member" })).toBe(true);
  });

  it("allows guests to view brand settings, but only admins can update them", () => {
    expect(can(user, "brandSettings:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "brandSettings:update", { type: "workspace", role: "member" })).toBe(false);
    expect(can(user, "brandSettings:update", { type: "workspace", role: "admin" })).toBe(true);
  });

  it("requires member+ to generate Copywriter copy", () => {
    expect(can(user, "copyGeneration:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "copyGeneration:create", { type: "workspace", role: "member" })).toBe(true);
  });

  it("only allows admins+ to delete task templates, but members can create them", () => {
    expect(can(user, "taskTemplate:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "taskTemplate:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "taskTemplate:create", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "taskTemplate:delete", { type: "workspace", role: "member" })).toBe(false);
    expect(can(user, "taskTemplate:delete", { type: "workspace", role: "admin" })).toBe(true);
  });

  it("allows guests to view docs, but only members can create/update/delete them", () => {
    expect(can(user, "doc:view", { type: "workspace", role: "guest" })).toBe(true);
    expect(can(user, "doc:create", { type: "workspace", role: "guest" })).toBe(false);
    expect(can(user, "doc:create", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "doc:update", { type: "workspace", role: "member" })).toBe(true);
    expect(can(user, "doc:delete", { type: "workspace", role: "guest" })).toBe(false);
  });

  describe("custom role grants/revokes (Phase 6)", () => {
    it("grants a guest an action their base rank would normally deny", () => {
      const resource = {
        type: "workspace" as const,
        role: "guest" as const,
        customRole: { grants: ["task:create" as const], revokes: [] },
      };
      expect(can(user, "task:create", resource)).toBe(true);
      // Unrelated actions still fall through to the base rank check.
      expect(can(user, "hierarchy:delete", resource)).toBe(false);
    });

    it("revokes an action an owner's base rank would normally allow", () => {
      const resource = {
        type: "workspace" as const,
        role: "owner" as const,
        customRole: { grants: [], revokes: ["task:delete" as const] },
      };
      expect(can(user, "task:delete", resource)).toBe(false);
      expect(can(user, "task:create", resource)).toBe(true);
    });

    it("revoke wins over grant for the same action", () => {
      const resource = {
        type: "workspace" as const,
        role: "member" as const,
        customRole: { grants: ["task:delete" as const], revokes: ["task:delete" as const] },
      };
      expect(can(user, "task:delete", resource)).toBe(false);
    });

    it("a membership with no custom role is unaffected (backward compatible)", () => {
      expect(
        can(user, "task:create", { type: "workspace", role: "member", customRole: null }),
      ).toBe(true);
    });
  });

  describe("space overrides (Phase 6)", () => {
    it("an allow override beats a base rank that would otherwise deny", () => {
      expect(
        can(user, "task:create", { type: "workspace", role: "guest", spaceOverride: true }),
      ).toBe(true);
    });

    it("a deny override beats a base rank that would otherwise allow", () => {
      expect(
        can(user, "task:create", { type: "workspace", role: "owner", spaceOverride: false }),
      ).toBe(false);
    });

    it("a space override beats a custom role's grants/revokes too — most specific layer wins", () => {
      const resource = {
        type: "workspace" as const,
        role: "guest" as const,
        customRole: { grants: [], revokes: ["task:create" as const] },
        spaceOverride: true,
      };
      expect(can(user, "task:create", resource)).toBe(true);
    });

    it("no override resolved (undefined/null) falls through to the base/custom-role check", () => {
      expect(
        can(user, "task:create", { type: "workspace", role: "guest", spaceOverride: null }),
      ).toBe(false);
      expect(can(user, "task:create", { type: "workspace", role: "member" })).toBe(true);
    });
  });

  describe("isGrantable", () => {
    it("excludes owner-tier actions from being grantable via custom role or space override", () => {
      expect(isGrantable("workspace:delete")).toBe(false);
    });

    it("allows admin-tier-and-below actions to be granted", () => {
      expect(isGrantable("task:create")).toBe(true);
      expect(isGrantable("automation:create")).toBe(true);
    });
  });
});
