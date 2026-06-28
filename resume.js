/* JobPulse — AI résumé & cover-letter builder.
 *
 * Flow:  upload/paste your résumé  +  company name  +  job description
 *        -> serverless function calls Gemini (free tier; key stays server-side)
 *        -> tailored, ATS-strong résumé + cover letter
 *        -> download each as a clean, single-column PDF (selectable text).
 *
 * The AI endpoint is a serverless function so the API key is never shipped to
 * the browser. Configure the deployed path below if you host it elsewhere.
 */
(function () {
  "use strict";

  // Where the AI function lives. `/api/tailor` on Vercel; `/.netlify/functions/
  // tailor` on Netlify. We try the configured/Vercel path first and fall back to
  // the Netlify path, so the same build works on either host.
  const AI_ENDPOINTS = (typeof window !== "undefined" && window.JOBPULSE_AI_ENDPOINT)
    ? [window.JOBPULSE_AI_ENDPOINT]
    : ["/api/tailor", "/.netlify/functions/tailor"];

  const $ = (id) => document.getElementById(id);

  // pdf.js worker (matches the v3 UMD build loaded in index.html).
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  /* ---------- download-folder picker (File System Access API) ----------
   * Browsers don't let pages dictate a save path — but if the user picks a
   * directory ONCE via showDirectoryPicker(), we can write subsequent files
   * straight into it without prompts. Handle persists in IndexedDB so it
   * survives reloads. Chrome/Edge only; falls back to default browser
   * download on Firefox/Safari (where the API doesn't exist).
   */
  const FS_DB_NAME = "jobpulse-fs";
  const FS_STORE = "handles";
  const FS_KEY = "downloadDir";
  const fsSupported = () => typeof window.showDirectoryPicker === "function";

  function fsOpenDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
      const req = window.indexedDB.open(FS_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(FS_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function fsTx(mode, fn) {
    const db = await fsOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FS_STORE, mode);
      const store = tx.objectStore(FS_STORE);
      const out = fn(store);
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function fsLoadHandle() {
    try { return await fsTx("readonly", (s) => s.get(FS_KEY)) || null; }
    catch (_) { return null; }
  }
  async function fsSaveHandle(handle) {
    try { await fsTx("readwrite", (s) => s.put(handle, FS_KEY)); } catch (_) {}
  }
  async function fsClearHandle() {
    try { await fsTx("readwrite", (s) => s.delete(FS_KEY)); } catch (_) {}
  }
  async function fsPickFolder() {
    if (!fsSupported()) {
      alert("Your browser doesn't support choosing a folder. Use Chrome or Edge, or just change the browser's default download folder.");
      return null;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite", startIn: "desktop" });
      await fsSaveHandle(handle);
      return handle;
    } catch (err) {
      if (err && err.name === "AbortError") return null; // user cancelled
      console.warn("Folder pick failed:", err);
      return null;
    }
  }
  async function fsWritableHandle() {
    const handle = await fsLoadHandle();
    if (!handle) return null;
    try {
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm === "granted") return handle;
      const req = await handle.requestPermission({ mode: "readwrite" });
      return req === "granted" ? handle : null;
    } catch (_) { return null; }
  }
  async function fsWriteBlob(handle, filename, blob) {
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }
  async function fsRefreshButton() {
    const btn = $("setDownloadFolder");
    if (!btn) return;
    if (!fsSupported()) {
      btn.textContent = "Folder picker unsupported here";
      btn.disabled = true;
      btn.title = "Use Chrome or Edge, or change your browser's default download folder.";
      return;
    }
    const handle = await fsLoadHandle();
    if (handle && handle.name) {
      btn.textContent = `Downloads → ${handle.name} · Change`;
      btn.classList.add("active");
      btn.title = `Files will be saved to your chosen "${handle.name}" folder.`;
    } else {
      btn.textContent = "Set download folder";
      btn.classList.remove("active");
      btn.title = "Pick a folder once; future résumé + cover-letter + Excel downloads land there.";
    }
  }

  let resumeFileText = ""; // extracted text from an uploaded file

  /* ---------- résumé file parsing ---------- */

  async function extractPdf(arrayBuffer) {
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let p = 1; p <= pdf.numPages; p += 1) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((i) => i.str).join(" ") + "\n";
    }
    return text.trim();
  }

  async function extractDocx(arrayBuffer) {
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return (result.value || "").trim();
  }

  async function handleFile(file) {
    const nameEl = $("rFileName");
    nameEl.textContent = `Reading ${file.name}…`;
    try {
      const buf = await file.arrayBuffer();
      const ext = file.name.toLowerCase().split(".").pop();
      if (ext === "pdf") {
        resumeFileText = await extractPdf(buf);
      } else if (ext === "docx" || ext === "doc") {
        resumeFileText = await extractDocx(buf);
      } else {
        resumeFileText = new TextDecoder().decode(buf).trim();
      }
      if (!resumeFileText) throw new Error("No selectable text found");
      nameEl.textContent = `${file.name} ✓ (${resumeFileText.length} chars read)`;
    } catch (err) {
      resumeFileText = "";
      nameEl.textContent =
        `Could not read ${file.name}. If it is a scanned/image PDF, paste the text instead.`;
      console.error("Résumé parse failed:", err);
    }
  }

  function resumeText() {
    return ($("rResumeText").value.trim() || resumeFileText || "").trim();
  }

  /* ---------- status helper ---------- */

  function setStatus(value, hint, cls) {
    $("atsScoreValue").textContent = value;
    $("atsScoreValue").className = cls || "";
    $("atsScoreHint").textContent = hint;
  }

  /* ---------- AI generation ---------- */

  async function generate() {
    const resume = resumeText();
    const company = $("rCompany").value.trim();
    const jobDesc = $("rJobDesc").value.trim();

    if (!resume) return setStatus("Need résumé", "Upload or paste your current résumé first.", "score-low");
    if (!company) return setStatus("Need company", "Enter the company name.", "score-low");
    if (!jobDesc) return setStatus("Need job", "Paste the job description so it can be tailored.", "score-low");

    const btn = $("generateDocs");
    btn.disabled = true;
    btn.textContent = "Generating…";
    setStatus("Working…", `Tailoring your application to ${company}.`, "score-mid");

    try {
      const profile = (typeof state !== "undefined" && state.profile) || {};
      const requestBody = JSON.stringify({
        resume,
        company,
        jobDescription: jobDesc,
        portfolio: profile.portfolio || "",
        currentlyLearning: profile.learning || "",
      });
      let res = null;
      let lastDetail = "";

      // Try each endpoint; skip a host whose route simply isn't there (404/405).
      for (const endpoint of AI_ENDPOINTS) {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });
        if (r.ok) { res = r; break; }
        lastDetail = `${r.status} ${(await r.text()).slice(0, 200)}`;
        if (r.status !== 404 && r.status !== 405) { res = r; break; }
      }

      if (!res || !res.ok) throw new Error(lastDetail || "No AI endpoint responded");

      const data = await res.json();
      $("resumeTextOut").value = (data.resume || "").trim();
      $("coverTextOut").value = (data.coverLetter || "").trim();
      const notes = Array.isArray(data.notes) ? data.notes : [];
      const hint = notes.length
        ? `Tailored for ${company}. ⚠ Fix before sending: ${notes.join(" • ")}`
        : `Tailored for ${company}. Edit if needed, then download PDF.`;
      setStatus("Done", hint, notes.length ? "score-mid" : "score-good");
    } catch (err) {
      console.error("AI generation failed:", err);
      const detail = String(err && err.message ? err.message : err);
      // Quota exhaustion is the most common "failure" — Gemini free tier resets
      // around midnight Pacific. Surface that honestly instead of saying offline.
      if (/429|quota|rate[- ]?limit/i.test(detail)) {
        setStatus(
          "Daily AI limit reached",
          "Your Gemini free-tier quota for today is used up. It resets around midnight US-Pacific. You can still copy/paste an answer manually until then.",
          "score-low"
        );
      } else if (/404|not.?found/i.test(detail)) {
        setStatus(
          "Endpoint missing",
          "The /api/tailor endpoint isn't on this deployment. Check Vercel deployment logs.",
          "score-low"
        );
      } else if (/GEMINI_API_KEY/i.test(detail)) {
        setStatus(
          "Missing API key",
          "GEMINI_API_KEY isn't set on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.",
          "score-low"
        );
      } else {
        setStatus(
          "AI error",
          `Generation failed: ${detail.slice(0, 200)}`,
          "score-low"
        );
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate documents";
    }
  }

  /* ---------- PDF export (clean, single-column, ATS-safe) ---------- */

  // Replace non-ASCII punctuation so standard PDF fonts render cleanly (no "?").
  function sanitize(text) {
    return text
      .replace(/\r/g, "")
      .replace(/[–—‒]/g, "-")
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[•●▪·]/g, "-")
      .replace(/…/g, "...")
      .replace(/[→⇒]/g, "->")
      .replace(/ /g, " ")
      .replace(/[^\x09\x0A\x20-\x7E]/g, "");
  }

  // Brief visual confirmation on the actual button that was clicked.
  function flashSaved(kind, message) {
    const btn = document.querySelector(`[data-pdf="${kind}"]`);
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = message || "Saved ✓";
    btn.classList.add("flash-saved");
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove("flash-saved");
    }, 1800);
  }

  function downloadPdf(kind) {
    const isResume = kind === "resume";
    const raw = $(isResume ? "resumeTextOut" : "coverTextOut").value.trim();
    if (!raw) {
      setStatus("Nothing yet", "Click 'Generate documents' first — the output box is empty.", "score-low");
      flashSaved(kind, "Generate first ⚠");
      return;
    }
    const text = sanitize(raw);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const company = ($("rCompany").value.trim() || "JobPulse").replace(/\s+/g, "_");
    const filename = `${company}_${isResume ? "Resume" : "Cover_Letter"}.pdf`;

    // Base typography (Helvetica = Arial-like, ATS-standard). Auto-scaled to fit.
    const SIZE = { name: 16, heading: 11.5, body: 10 };
    const LH = { name: 19, heading: 15, body: 12.5 };
    const GAP = { blank: 5, rule: 8, afterHeading: 2 };
    const sizeKey = (t) => (t === "name" ? "name" : t === "heading" ? "heading" : "body");

    // Classify each line once.
    const items = text.split("\n").map((lineRaw, idx) => {
      const line = lineRaw.replace(/\s+$/g, "");
      const t = line.trim();
      if (/^[-=_]{3,}$/.test(t)) return { type: "rule" };
      if (!t) return { type: "blank" };
      if (idx === 0) return { type: "name", text: line };
      const isHeading = line === line.toUpperCase() && /[A-Z]/.test(line) && t.length < 40;
      return { type: isHeading ? "heading" : "body", text: line };
    });

    // Total height at a given scale + margin (wraps text to width).
    function measure(scale, margin) {
      const maxW = pageW - margin * 2;
      let h = margin * 2; // top + bottom
      items.forEach((it) => {
        if (it.type === "blank") { h += GAP.blank * scale; return; }
        if (it.type === "rule") { h += GAP.rule * scale; return; }
        const k = sizeKey(it.type);
        doc.setFont("helvetica", it.type === "body" ? "normal" : "bold");
        doc.setFontSize(SIZE[k] * scale);
        h += doc.splitTextToSize(it.text, maxW).length * LH[k] * scale;
        if (it.type === "heading") h += GAP.afterHeading * scale;
      });
      return h;
    }

    // Shrink margin then font scale until it fits on ONE page.
    let margin = 46;
    let scale = 1;
    if (measure(scale, margin) > pageH) {
      margin = 34;
      while (measure(scale, margin) > pageH && scale > 0.7) scale -= 0.02;
    }

    // Render.
    const maxW = pageW - margin * 2;
    let y = margin + SIZE.name * scale;
    items.forEach((it) => {
      if (it.type === "blank") { y += GAP.blank * scale; return; }
      if (it.type === "rule") { doc.setDrawColor(160); doc.line(margin, y - 6 * scale, pageW - margin, y - 6 * scale); y += GAP.rule * scale; return; }
      const k = sizeKey(it.type);
      doc.setFont("helvetica", it.type === "body" ? "normal" : "bold");
      doc.setFontSize(SIZE[k] * scale);
      doc.splitTextToSize(it.text, maxW).forEach((w) => {
        doc.text(w, margin, y);
        y += LH[k] * scale;
      });
      if (it.type === "heading") y += GAP.afterHeading * scale;
    });

    // If the user picked a JobPulse folder, write straight into it. Otherwise
    // fall back to the standard browser download (default Downloads folder).
    (async () => {
      const handle = await fsWritableHandle();
      if (handle) {
        try {
          await fsWriteBlob(handle, filename, doc.output("blob"));
          setStatus("Saved", `Wrote ${filename} into your "${handle.name}" folder.`, "score-mid");
          flashSaved(kind, `Saved to ${handle.name} ✓`);
          return;
        } catch (err) {
          console.warn("Direct-write to chosen folder failed; falling back to default download.", err);
          setStatus("Save failed", `Could not write to "${handle.name}". Downloading to your default Downloads folder instead.`, "score-low");
        }
      }
      doc.save(filename);
      flashSaved(kind, "Downloaded ✓");
    })();
  }

  /* ---------- clipboard ---------- */

  async function copyText(targetId, btn) {
    const text = $(targetId).value;
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      $(targetId).select();
      document.execCommand("copy");
    }
    const original = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = original; }, 1400);
  }

  /* ---------- prefill from a dashboard "Tailor résumé" click ---------- */

  function prefillFromDashboard() {
    try {
      const stash = sessionStorage.getItem("jobpulse-tailor");
      if (stash) {
        const t = JSON.parse(stash);
        $("rCompany").value = t.company || "";
        $("rJobDesc").value = t.jobDesc || "";
        sessionStorage.removeItem("jobpulse-tailor");

        // Clear any previous role's output so the user never sees stale text.
        // This was the "same résumé for every role" bug — the textareas held the
        // last generation, and unless the user clicked Generate again, the new
        // role looked identical to the old one.
        $("resumeTextOut").value = "";
        $("coverTextOut").value = "";

        const haveResume =
          (typeof resumeFileText === "string" && resumeFileText.trim().length > 200) ||
          ($("rResumeText").value.trim().length > 200);

        if (haveResume) {
          setStatus("Tailoring", `Generating fresh résumé + cover letter for ${t.title || "role"} at ${t.company}…`, "score-mid");
          // Small delay so the user sees the prefill happen, then auto-Generate.
          setTimeout(() => $("generateDocs").click(), 250);
        } else {
          setStatus("Ready", `Loaded ${t.title || "role"} at ${t.company}. Upload or paste your résumé, then Generate.`, "score-mid");
        }
        return;
      }
      if (typeof state !== "undefined" && typeof jobs !== "undefined" && !$("rCompany").value) {
        const target = jobs.find((j) => state.applied[j.id] || state.saved[j.id]);
        if (target) $("rCompany").value = target.company;
      }
    } catch (_) { /* not ready */ }
  }

  /* ---------- Excel tracker export (4 sheets) ---------- */

  function exportExcel() {
    if (!window.XLSX) return;
    const all = (typeof jobs !== "undefined" && Array.isArray(jobs)) ? jobs : [];
    const st = (typeof state !== "undefined" && state) || { saved: {}, applied: {} };
    const today = new Date().toISOString().slice(0, 10);

    const shortlist = all.map((j) => ({
      Title: j.title, Company: j.company, Location: j.location,
      "Apply Link": j.url, "Fit Band": j.fitBand || "", "Fit %": j.match || j.fit || "",
      "Skills Match": `${j.skillHits || 0}/${j.skillsTotal || 0} skills`,
      "Sponsorship (VERIFY)": j.sponsorship ? j.sponsorship.likelihood : "VERIFY",
      Status: st.applied[j.id] ? "Applied" : st.saved[j.id] ? "Saved" : "New",
      "Date Found": today,
    }));

    const sponsorship = all.map((j) => ({
      Company: j.company,
      "h1bdata lookup": j.sponsorship ? j.sponsorship.verifyUrl : `https://h1bdata.info/index.php?em=${encodeURIComponent(j.company)}`,
      "myvisajobs": `https://www.myvisajobs.com/search?q=${encodeURIComponent(j.company)}`,
      "Likelihood (heuristic)": j.sponsorship ? j.sponsorship.likelihood : "Unknown",
      Step: "Confirm recent H-1B filings before investing effort",
    }));

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(shortlist.length ? shortlist : [{ Note: "Load the dashboard first" }]), "Vetted Shortlist");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet([{ Note: "Borderline roles you flag go here" }]), "Flagged");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet([{ Note: "Excluded roles are filtered automatically by the feed (senior, no-sponsorship, contract, stack mismatch, staffing)" }]), "Excluded");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(sponsorship.length ? sponsorship : [{ Note: "Load the dashboard first" }]), "Sponsorship Verification");
    const xlsxName = `Vruttant_JobSearch_Tracker_${today}.xlsx`;
    (async () => {
      const handle = await fsWritableHandle();
      if (handle) {
        try {
          const buf = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
          const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
          await fsWriteBlob(handle, xlsxName, blob);
          return;
        } catch (err) {
          console.warn("Excel direct-write failed; falling back to default download.", err);
        }
      }
      window.XLSX.writeFile(wb, xlsxName);
    })();
  }

  /* ---------- wiring ---------- */

  function init() {
    if (!$("generateDocs")) return;

    $("rFile").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    });
    // Belt-and-suspenders: a programmatic click on the file input from the
    // visible "Upload" CTA. The standard <label for="rFile"> association
    // usually triggers the picker, but on some Chrome versions / extensions
    // the click can be eaten — this guarantees it opens.
    const uploadCta = document.querySelector(".file-drop-cta");
    if (uploadCta) {
      uploadCta.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("rFile").click();
      });
    }

    $("generateDocs").addEventListener("click", generate);

    document.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", () => copyText(btn.dataset.copy, btn));
    });
    document.querySelectorAll("[data-pdf]").forEach((btn) => {
      btn.addEventListener("click", () => downloadPdf(btn.dataset.pdf));
    });

    document.querySelectorAll('.nav-item[data-view="resume"]').forEach((nav) => {
      nav.addEventListener("click", prefillFromDashboard);
    });

    if ($("exportExcel")) $("exportExcel").addEventListener("click", exportExcel);

    const folderBtn = $("setDownloadFolder");
    if (folderBtn) {
      folderBtn.addEventListener("click", async () => {
        // If a folder is already chosen, second click lets the user re-pick (no separate "clear").
        await fsPickFolder();
        await fsRefreshButton();
      });
      fsRefreshButton();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
