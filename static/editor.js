import { basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder,
} from "@codemirror/view";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const languageConfig = new Compartment();
const completionConfig = new Compartment();
let view = null;
let currentLanguage = "cuda";
let currentSignature = "solve(...)";
let changeListener = () => {};
let runListener = () => {};

const kernelTheme = EditorView.theme({
  "&": { height: "100%", color: "#d7f2c8", backgroundColor: "#111510" },
  ".cm-content": { padding: "18px 0", caretColor: "#d8ff3e" },
  ".cm-line": { padding: "0 18px" },
  ".cm-scroller": { fontFamily: "var(--mono)", fontSize: "13px", lineHeight: "1.65", overflow: "auto" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#d8ff3e" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "#40512d" },
  ".cm-activeLine": { backgroundColor: "#171d15" },
  ".cm-gutters": { color: "#566052", backgroundColor: "#111510", border: "none", paddingLeft: "8px" },
  ".cm-activeLineGutter": { color: "#d8ff3e", backgroundColor: "#171d15" },
  ".cm-foldPlaceholder": { color: "#111510", backgroundColor: "#d8ff3e", border: "none" },
  ".cm-tooltip": { color: "#d9ded3", backgroundColor: "#20261e", border: "1px solid #485043" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { color: "#11140f", backgroundColor: "#d8ff3e" },
  ".cm-completionDetail": { color: "#899084", fontStyle: "normal" },
  ".cm-panels": { color: "#d9ded3", backgroundColor: "#20261e" },
  ".cm-searchMatch": { backgroundColor: "#635529", outline: "1px solid #d8b83e" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#40512d" },
}, { dark: true });

const kernelHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: "#ff8764" },
  { tag: [tags.name, tags.variableName], color: "#d7f2c8" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#d8ff3e" },
  { tag: [tags.typeName, tags.className], color: "#79d9d0" },
  { tag: [tags.string, tags.special(tags.string)], color: "#e6c77a" },
  { tag: [tags.number, tags.bool, tags.null], color: "#cda1ff" },
  { tag: [tags.comment, tags.docComment], color: "#71806b", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation], color: "#aeb7aa" },
  { tag: tags.meta, color: "#80bfff" },
]);

const commonCuda = [
  ["__global__", "keyword", "CUDA kernel qualifier"],
  ["__device__", "keyword", "Device function qualifier"],
  ["__host__", "keyword", "Host function qualifier"],
  ["__shared__", "keyword", "Shared memory qualifier"],
  ["threadIdx", "variable", "Current thread index"],
  ["blockIdx", "variable", "Current block index"],
  ["blockDim", "variable", "Threads per block"],
  ["gridDim", "variable", "Blocks in grid"],
  ["warpSize", "constant", "Threads per warp"],
  ["__syncthreads()", "function", "Synchronize threads in a block"],
  ["__syncwarp()", "function", "Synchronize threads in a warp"],
  ["__shfl_sync()", "function", "Exchange values within a warp"],
  ["atomicAdd()", "function", "Atomic addition"],
  ["atomicMax()", "function", "Atomic maximum"],
  ["dim3", "type", "CUDA dimension type"],
  ["half", "type", "16-bit floating-point type"],
  ["float2", "type", "Two packed floats"],
  ["float4", "type", "Four packed floats"],
];

const commonPython = [
  ["torch.empty", "function", "Create an uninitialized tensor"],
  ["torch.zeros", "function", "Create a zero-filled tensor"],
  ["torch.empty_like", "function", "Create a tensor with matching shape"],
  ["torch.zeros_like", "function", "Create a zero tensor with matching shape"],
  ["torch.matmul", "function", "Matrix multiplication"],
  ["torch.compile", "function", "Compile a Python function"],
  ["torch.float16", "constant", "16-bit floating-point dtype"],
  ["torch.float32", "constant", "32-bit floating-point dtype"],
  ["torch.int32", "constant", "32-bit integer dtype"],
];

const languageWords = {
  cuda: commonCuda,
  pytorch: commonPython,
  triton: [
    ...commonPython,
    ["@triton.jit", "keyword", "Compile a Triton kernel"],
    ["tl.constexpr", "type", "Compile-time constant"],
    ["tl.program_id", "function", "Current program instance"],
    ["tl.arange", "function", "Contiguous index vector"],
    ["tl.load", "function", "Load values with an optional mask"],
    ["tl.store", "function", "Store values with an optional mask"],
    ["tl.dot", "function", "Block matrix multiplication"],
    ["tl.sum", "function", "Reduce by addition"],
    ["tl.max", "function", "Reduce by maximum"],
    ["triton.cdiv", "function", "Ceiling division"],
  ],
  cutedsl: [
    ...commonPython,
    ["@cute.jit", "keyword", "Compile a CuTeDSL function"],
    ["cute.compile", "function", "Compile a CuTeDSL function"],
    ["cute.make_tensor", "function", "Create a CuTe tensor"],
    ["cute.make_layout", "function", "Create a tensor layout"],
    ["cute.copy", "function", "Copy between tensors"],
    ["cute.gemm", "function", "Perform matrix multiplication"],
  ],
  tilelang: [
    ...commonPython,
    ["@tilelang.jit", "keyword", "Compile a TileLang kernel"],
    ["T.Kernel", "function", "Define the kernel launch grid"],
    ["T.alloc_shared", "function", "Allocate shared memory"],
    ["T.alloc_fragment", "function", "Allocate a register fragment"],
    ["T.copy", "function", "Copy between buffers"],
    ["T.gemm", "function", "Perform matrix multiplication"],
    ["T.Parallel", "function", "Create parallel loop axes"],
    ["T.serial", "function", "Create a serial loop"],
  ],
};

function signatureParameters(signature) {
  const match = signature.match(/solve\s*\((.*)\)/s);
  if (!match || match[1].trim() === "...") return [];
  return match[1].split(",").map((argument) => {
    const clean = argument.split("=")[0].trim();
    const pythonName = clean.split(":")[0].trim();
    const cudaName = clean.match(/([A-Za-z_]\w*)\s*(?:\[\s*\])?$/)?.[1];
    return cudaName || pythonName;
  }).filter((name) => /^[A-Za-z_]\w*$/.test(name));
}

function completionOptions(context) {
  const options = (languageWords[currentLanguage] || commonPython).map(([label, type, detail]) => ({ label, type, detail }));
  for (const label of signatureParameters(currentSignature)) {
    options.push({ label, type: "variable", detail: "solve parameter" });
  }
  const identifiers = context.state.doc.toString().match(/[A-Za-z_]\w*/g) || [];
  for (const label of new Set(identifiers)) {
    if (label.length > 2) options.push({ label, type: "variable", detail: "Current document" });
  }
  return [...new Map(options.map((option) => [option.label, option])).values()];
}

function domainCompletion(context) {
  const word = context.matchBefore(/[A-Za-z_@][\w.]*/);
  if (!word && !context.explicit) return null;
  return {
    from: word ? word.from : context.pos,
    options: completionOptions(context),
    validFor: /^[\w.@]*$/,
  };
}

function languageExtension(language) {
  return language === "cuda" ? cpp() : python();
}

function initialize({ parent, value = "", language = "cuda", signature = "solve(...)", onChange, onRun }) {
  currentLanguage = language;
  currentSignature = signature;
  changeListener = onChange || (() => {});
  runListener = onRun || (() => {});
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        kernelTheme,
        syntaxHighlighting(kernelHighlightStyle),
        EditorState.tabSize.of(4),
        indentUnit.of("\t"),
        languageConfig.of(languageExtension(language)),
        completionConfig.of(autocompletion({ override: [domainCompletion], activateOnTyping: true })),
        closeBrackets(),
        keymap.of([
          ...closeBracketsKeymap,
          ...completionKeymap,
          indentWithTab,
          { key: "Ctrl-Enter", run: () => { runListener(); return true; } },
          { key: "Cmd-Enter", run: () => { runListener(); return true; } },
        ]),
        placeholder("在这里编写 GPU 代码..."),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changeListener(update.state.doc.toString());
        }),
      ],
    }),
  });
}

function setLanguage(language, signature = "solve(...)") {
  currentLanguage = language;
  currentSignature = signature;
  view.dispatch({
    effects: [
      languageConfig.reconfigure(languageExtension(language)),
      completionConfig.reconfigure(autocompletion({ override: [domainCompletion], activateOnTyping: true })),
    ],
  });
}

function setValue(value) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
}

window.KernelEditor = {
  initialize,
  setLanguage,
  setValue,
  getValue: () => view?.state.doc.toString() || "",
  focus: () => view?.focus(),
};
