import { groupDocs } from "./editor-drawer";
import { Doc } from "./editor-model";

function doc(id: string, fields: Partial<Doc> = {}): Doc {
  return { id, body: `# ${id}`, bodyLoaded: true, ...fields };
}

describe("groupDocs", () => {
  it("orders parents by their own last edit and children oldest first", () => {
    const groups = groupDocs([
      doc("late-child", { parentId: "source", createdAt: "2026-08-03T12:00:00Z", updatedAt: "2026-08-09T10:00:00Z" }),
      doc("source", { updatedAt: "2026-08-01T10:00:00Z" }),
      doc("alone", { updatedAt: "2026-08-02T10:00:00Z" }),
      doc("early-child", { parentId: "source", createdAt: "2026-08-03T11:00:00Z", updatedAt: "2026-08-03T11:00:00Z" })
    ]);

    expect(groups.map((group) => group.doc.id)).toEqual(["alone", "source"]);
    expect(groups[0].children).toEqual([]);
    expect(groups[1].children.map((child) => child.id)).toEqual(["early-child", "late-child"]);
  });

  it("lists a derived doc on its own until its parent has loaded", () => {
    const child = doc("child", { parentId: "not-loaded-yet", updatedAt: "2026-08-02T10:00:00Z" });

    expect(groupDocs([child]).map((group) => group.doc.id)).toEqual(["child"]);
    const groups = groupDocs([child, doc("not-loaded-yet", { updatedAt: "2026-08-01T10:00:00Z" })]);
    expect(groups.map((group) => group.doc.id)).toEqual(["not-loaded-yet"]);
    expect(groups[0].children.map((entry) => entry.id)).toEqual(["child"]);
  });
});
