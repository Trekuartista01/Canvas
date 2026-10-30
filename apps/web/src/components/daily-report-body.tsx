import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

/**
 * M7.3 daily report body — TipTap JSON in, TipTap JSON out. `editable`
 * false renders the same document read-only (history, team view).
 */
export function DailyReportBody({
  content,
  editable,
  onEditor,
}: {
  content: unknown;
  editable: boolean;
  onEditor?: (editor: Editor | null) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    editable,
    content: (content as object | null) ?? "",
    editorProps: {
      attributes: {
        class: `prose prose-sm dark:prose-invert max-w-none focus:outline-none ${editable ? "min-h-40" : ""}`,
        "aria-label": "Daily report",
      },
    },
  });

  useEffect(() => {
    onEditor?.(editor);
  }, [editor, onEditor]);

  // `content` only seeds the editor; a read-only view must follow fresher
  // data (e.g. the author edited it and realtime refetched).
  useEffect(() => {
    if (!editor || editable || content === undefined) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) {
      editor.commands.setContent((content as object | null) ?? "");
    }
  }, [editor, editable, content]);

  return (
    <div className={editable ? "border-border rounded-md border p-3" : ""}>
      <EditorContent editor={editor} />
    </div>
  );
}
