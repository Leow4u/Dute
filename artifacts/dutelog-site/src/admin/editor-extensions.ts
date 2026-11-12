import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";

export function blogEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      codeBlock: false,
      code: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: { target: null, rel: null, class: null },
      },
    }),
    Image.configure({ allowBase64: false }),
  ];
}
