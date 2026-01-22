const pdfInput = document.getElementById("pdfInput");
const fileMeta = document.getElementById("fileMeta");
const moduleInput = document.getElementById("moduleInput");
const processBtn = document.getElementById("processBtn");
const detectBtn = document.getElementById("detectBtn");
const detectStatus = document.getElementById("detectStatus");
const outputList = document.getElementById("outputList");
const pageCountBadge = document.getElementById("pageCount");

const MAX_PART_PAGES = 25;
let loadedPdfBytes = null;
let totalPages = 0;
let detectedModules = null;

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const updateFileMeta = (file) => {
  if (!file) {
    fileMeta.textContent = "No file selected.";
    pageCountBadge.textContent = "Pages: --";
    return;
  }

  fileMeta.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
};

const parseModuleLines = (lines) => {
  const modules = [];

  lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line, index) => {
      const [namePart, rangePart] = line.split("|").map((piece) => piece.trim());
      if (!rangePart) {
        throw new Error(`Line ${index + 1}: Missing page range.`);
      }
      const rangeMatch = rangePart.match(/(\d+)\s*-\s*(\d+)/);
      if (!rangeMatch) {
        throw new Error(`Line ${index + 1}: Invalid range format.`);
      }
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start < 1 || end < start) {
        throw new Error(`Line ${index + 1}: Invalid page range.`);
      }
      modules.push({
        name: namePart || `Module ${modules.length + 1}`,
        start,
        end,
      });
    });

  return modules;
};

const sanitizeModuleName = (label, fallbackIndex) => {
  const clean = label.replace(/\s+/g, " ").trim();
  return clean || `Module ${fallbackIndex}`;
};

const buildDefaultModules = (pageCount) => {
  const modules = [];
  let page = 1;
  let index = 1;

  while (page <= pageCount) {
    const end = Math.min(page + MAX_PART_PAGES - 1, pageCount);
    modules.push({
      name: `Module ${index}`,
      start: page,
      end,
    });
    page = end + 1;
    index += 1;
  }

  return modules;
};

const buildLinesFromItems = (items) => {
  const sorted = items
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
    }))
    .filter((item) => item.text && item.text.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  sorted.forEach((item) => {
    const existing = lines.find((line) => Math.abs(line.y - item.y) < 4);
    if (existing) {
      existing.text += ` ${item.text}`;
    } else {
      lines.push({ y: item.y, text: item.text });
    }
  });

  return lines;
};

const detectModulesFromPdf = async () => {
  if (!loadedPdfBytes) {
    alert("Please upload a PDF first.");
    return;
  }

  if (!window.pdfjsLib) {
    alert("PDF text extraction is unavailable. Please try again later.");
    return;
  }

  detectBtn.disabled = true;
  processBtn.disabled = true;
  detectStatus.textContent = "Scanning textbook for module headings...";

  try {
    const loadingTask = window.pdfjsLib.getDocument({ data: loadedPdfBytes });
    const pdf = await loadingTask.promise;
    const hits = [];
    const headingPattern = /^(module|unit|chapter)\s+(\d+)\b[:\-–]?\s*(.*)$/i;

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const lines = buildLinesFromItems(textContent.items);
      if (!lines.length) {
        continue;
      }
      const maxY = Math.max(...lines.map((line) => line.y));
      const topLines = lines.filter((line) => line.y >= maxY - 60);

      for (const line of topLines) {
        const match = line.text.match(headingPattern);
        if (match) {
          const label = match[0];
          hits.push({
            name: sanitizeModuleName(label, hits.length + 1),
            start: pageIndex,
          });
          break;
        }
      }
    }

    if (!hits.length) {
      detectedModules = null;
      detectStatus.textContent =
        "No module headings found. Try manual entry or auto-split.";
      return;
    }

    hits.sort((a, b) => a.start - b.start);
    const modules = hits.map((hit, index) => ({
      name: hit.name,
      start: hit.start,
      end:
        index < hits.length - 1
          ? Math.max(hit.start, hits[index + 1].start - 1)
          : totalPages,
    }));

    detectedModules = modules;
    moduleInput.value = modules
      .map((module) => `${module.name} | ${module.start}-${module.end}`)
      .join("\n");
    detectStatus.textContent = `Detected ${modules.length} modules from the PDF.`;
  } catch (error) {
    detectedModules = null;
    detectStatus.textContent = "Unable to detect modules from this PDF.";
    alert(error.message || "Something went wrong while scanning the PDF.");
  } finally {
    detectBtn.disabled = false;
    processBtn.disabled = false;
  }
};

const splitModuleIntoParts = (module) => {
  const parts = [];
  let partStart = module.start;
  let partIndex = 1;

  while (partStart <= module.end) {
    const partEnd = Math.min(partStart + MAX_PART_PAGES - 1, module.end);
    parts.push({
      name: partIndex === 1 ? module.name : `${module.name} · Part ${partIndex}`,
      start: partStart,
      end: partEnd,
    });
    partStart = partEnd + 1;
    partIndex += 1;
  }

  return parts;
};

const clearOutputs = () => {
  outputList.innerHTML = "";
};

const addOutputItem = (name, rangeLabel, url) => {
  const li = document.createElement("li");
  const info = document.createElement("div");
  info.className = "output-info";

  const title = document.createElement("strong");
  title.textContent = name;

  const range = document.createElement("span");
  range.textContent = rangeLabel;

  info.append(title, range);

  const button = document.createElement("button");
  button.className = "download-btn";
  button.textContent = "Download";
  button.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/\s+/g, "-").toLowerCase()}.pdf`;
    link.click();
  });

  li.append(info, button);
  outputList.appendChild(li);
};

const loadPdf = async (file) => {
  loadedPdfBytes = await file.arrayBuffer();
  const pdfDoc = await PDFLib.PDFDocument.load(loadedPdfBytes);
  totalPages = pdfDoc.getPageCount();
  pageCountBadge.textContent = `Pages: ${totalPages}`;
  detectedModules = null;
  detectStatus.textContent = "";
};

const generateOutputs = async () => {
  if (!loadedPdfBytes) {
    alert("Please upload a PDF first.");
    return;
  }

  processBtn.disabled = true;
  processBtn.textContent = "Working...";
  clearOutputs();

  try {
    const rawLines = moduleInput.value.split("\n");
    let modules = rawLines.some((line) => line.trim())
      ? parseModuleLines(rawLines)
      : detectedModules || buildDefaultModules(totalPages);

    modules = modules.flatMap(splitModuleIntoParts);

    const sourceDoc = await PDFLib.PDFDocument.load(loadedPdfBytes);

    for (const module of modules) {
      const newDoc = await PDFLib.PDFDocument.create();
      const pageIndices = Array.from(
        { length: module.end - module.start + 1 },
        (_, idx) => module.start - 1 + idx
      );
      const copiedPages = await newDoc.copyPages(sourceDoc, pageIndices);
      copiedPages.forEach((page) => newDoc.addPage(page));

      const pdfBytes = await newDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      addOutputItem(
        module.name,
        `Pages ${module.start}–${module.end}`,
        url
      );
    }

    if (!modules.length) {
      outputList.innerHTML = "<li class=\"empty\">No modules generated.</li>";
    }
  } catch (error) {
    outputList.innerHTML = "<li class=\"empty\">Unable to process modules.</li>";
    alert(error.message || "Something went wrong while processing the PDF.");
  } finally {
    processBtn.disabled = false;
    processBtn.textContent = "Generate modules";
  }
};

pdfInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  updateFileMeta(file);

  if (file) {
    await loadPdf(file);
  }
});

processBtn.addEventListener("click", generateOutputs);
detectBtn.addEventListener("click", detectModulesFromPdf);
