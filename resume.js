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
      setStatus(
        "Offline",
        "AI endpoint unreachable. Deploy to Netlify with a GEMINI_API_KEY env var " +
          "(or run `netlify dev`) to enable generation.",
        "score-low"
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate documents";
    }
  }

  /* ---------- PDF export (clean, single-column, ATS-safe) ---------- */

  function downloadPdf(kind) {
    const isResume = kind === "resume";
    const text = $(isResume ? "resumeTextOut" : "coverTextOut").value.trim();
    if (!text) return setStatus("Nothing yet", "Generate the documents first.", "score-low");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 56; // ~0.78in
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const maxW = pageW - margin * 2;
    let y = margin;

    const company = ($("rCompany").value.trim() || "JobPulse").replace(/\s+/g, "_");
    const filename = `${company}_${isResume ? "Resume" : "Cover_Letter"}.pdf`;

    const newPageIfNeeded = (lineH) => {
      if (y + lineH > pageH - margin) {
        doc.addPage();
        y = margin;
      }
    };

    const lines = text.split("\n");
    lines.forEach((raw, idx) => {
      const line = raw.replace(/\s+$/g, "");

      // First non-empty line = name -> larger bold heading.
      const isName = idx === 0 && line.trim();
      // ALL-CAPS short lines = section headings.
      const isHeading =
        !isName && line.trim().length > 0 && line === line.toUpperCase() &&
        /[A-Z]/.test(line) && line.trim().length < 40;
      const isRule = /^[-=_]{3,}$/.test(line.trim());

      if (isRule) {
        doc.setDrawColor(150);
        newPageIfNeeded(10);
        doc.line(margin, y, pageW - margin, y);
        y += 10;
        return;
      }

      if (!line.trim()) { y += 7; return; } // blank line spacing

      doc.setFont("times", isName || isHeading ? "bold" : "normal");
      doc.setFontSize(isName ? 17 : isHeading ? 12 : 11);
      const lineH = isName ? 22 : isHeading ? 16 : 15;

      const wrapped = doc.splitTextToSize(line, maxW);
      wrapped.forEach((w) => {
        newPageIfNeeded(lineH);
        doc.text(w, margin, y);
        y += lineH;
      });
      if (isHeading) y += 2;
    });

    doc.save(filename);
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
        setStatus("Ready", `Loaded ${t.title || "role"} at ${t.company}. Add your résumé, then Generate.`, "score-mid");
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
    window.XLSX.writeFile(wb, `Vruttant_JobSearch_Tracker_${today}.xlsx`);
  }

  /* ---------- wiring ---------- */

  function init() {
    if (!$("generateDocs")) return;

    $("rFile").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    });

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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
