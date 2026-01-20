
import React, { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface LatexRendererProps {
  content: string;
}

// --- Helpers ---

const renderMath = (latex: string, displayMode: boolean): string => {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'html',
      trust: true
    });
  } catch (e) {
    return `<span class="text-red-500 font-mono text-xs bg-red-50 p-1 rounded">Math Error</span>`;
  }
};

const processLatexToHtml = (text: string): string => {
  const mathStore: { id: string; html: string; isDisplay: boolean }[] = [];
  
  // 1. Mask Math
  let processed = text.replace(
    /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\{(?:equation|align|gather|flalign|multline)\*?\}(?:[\s\S]*?)\\end\{(?:equation|align|gather|flalign|multline)\*?\}|\\\([\s\S]*?\\\)|(?<!\\)\$(?:\\.|[^$])*?(?<!\\)\$)/g,
    (match) => {
      const isDisplay = match.startsWith('$$') || match.startsWith('\\[') || match.startsWith('\\begin');
      let cleanLatex = match;
      if (match.startsWith('$$')) cleanLatex = match.slice(2, -2);
      else if (match.startsWith('\\[')) cleanLatex = match.slice(2, -2);
      else if (match.startsWith('\\(')) cleanLatex = match.slice(2, -2);
      else if (match.startsWith('$')) cleanLatex = match.slice(1, -1);
      
      const html = renderMath(cleanLatex, isDisplay);
      const id = `__MATH_${mathStore.length}__`;
      mathStore.push({ id, html, isDisplay });
      return id;
    }
  );

  // 2. Formatting
  processed = processed.replace(/\\textbf\{(.*?)\}/g, '<strong class="font-bold text-slate-900">$1</strong>');
  processed = processed.replace(/\\textit\{(.*?)\}/g, '<em class="italic text-slate-800">$1</em>');
  processed = processed.replace(/\\underline\{(.*?)\}/g, '<u class="underline decoration-slate-400 decoration-1 underline-offset-2">$1</u>');
  processed = processed.replace(/\\text\{(.*?)\}/g, '$1');

  // 3. Sections
  // Reduced top margin (mt-4 -> mt-2) and bottom margin (mb-2 -> mb-1)
  processed = processed.replace(
    /\\section\*?\{([^}]*)\}/g,
    '\n__SECTION_START__<h2 class="text-lg font-bold mt-2 mb-1 text-slate-900 leading-snug w-full first:mt-0 break-inside-avoid break-after-avoid uppercase">$1</h2>__SECTION_END__\n'
  );
  processed = processed.replace(
    /\\subsection\*?\{([^}]*)\}/g,
    '\n__SECTION_START__<h3 class="text-base font-bold mt-2 mb-1 text-slate-800 leading-snug w-full first:mt-0 break-inside-avoid break-after-avoid">$1</h3>__SECTION_END__\n'
  );

  // 4. Split Paragraphs
  const blocks = processed.split(/\n\s*\n/);
  
  const htmlBlocks = blocks.map(block => {
    let content = block.trim();
    if (!content) return "";

    if (content.includes('__SECTION_START__')) {
       return content.replace(/__SECTION_START__|__SECTION_END__/g, '');
    }

    if (content.match(/^__MATH_\d+__$/)) {
       const mathId = content;
       const entry = mathStore.find(m => m.id === mathId);
       if (entry && entry.isDisplay) {
         // Reduced margin for display math (my-2 -> my-1)
         return `<div class="my-1 flex justify-center w-full overflow-x-auto no-scrollbar">${entry.html}</div>`;
       }
    }

    content = content.replace(/__MATH_(\d+)__/g, (_, idx) => {
        const entry = mathStore[parseInt(idx)];
        return entry ? entry.html : '';
    });

    // Tightened mb-1.5 -> mb-1
    return `<p class="mb-1 indent-4 leading-relaxed text-slate-800 text-justify text-[0.95rem] break-inside-avoid">${content}</p>`;
  });

  return htmlBlocks.join("");
};


const LatexRenderer: React.FC<LatexRendererProps> = ({ content }) => {
  const htmlContent = useMemo(() => {
    if (!content) return "";

    const bodyMatch = content.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
    let body = bodyMatch ? bodyMatch[1] : content;
    
    if (!bodyMatch) {
       body = body.replace(/\\documentclass[\s\S]*?\\begin\{document\}/, '');
       body = body.replace(/\\usepackage\{.*?\}/g, '');
    }

    const multicolStore: { id: string; html: string }[] = [];
    
    // Switch from GRID to COLUMNS
    body = body.replace(/\\begin\{multicols\}\{(\d+)\}([\s\S]*?)\\end\{multicols\}/g, (match, cols, inner) => {
        const innerHtml = processLatexToHtml(inner);
        // Reduced gap (gap-6 -> gap-5) and margin (my-2 -> my-1)
        const colClass = `columns-1 md:columns-${cols} gap-5 my-1 w-full text-justify`;
        const html = `<div class="${colClass}">${innerHtml}</div>`;
        
        const id = `__MULTICOL_${multicolStore.length}__`;
        multicolStore.push({ id, html });
        return `\n\n${id}\n\n`;
    });

    let mainHtml = processLatexToHtml(body);

    mainHtml = mainHtml.replace(/<p[^>]*>\s*(__MULTICOL_\d+__)\s*<\/p>/g, '$1');
    mainHtml = mainHtml.replace(/__MULTICOL_(\d+)__/g, (_, idx) => {
       return multicolStore[parseInt(idx)]?.html || "";
    });

    return mainHtml;
  }, [content]);

  // Removed p-8, bg-white, shadow-sm, min-h-[297mm] to avoid double padding/styling with the container in App.tsx
  return (
    <div
      className="latex-document font-serif text-slate-900 w-full"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};

export default LatexRenderer;
