/** Reserve the window during the click, before network work loses user activation. */
export async function openReportPreview(
  generate: () => Promise<{ html: string }>,
) {
  const preview = window.open("", "_blank");
  if (!preview)
    throw new Error(
      "Allow popups for this application, then try exporting again.",
    );
  preview.opener = null;
  preview.document.title = "Preparing report · Smart Factory";
  preview.document.body.textContent = "Preparing your report…";
  try {
    const { html } = await generate();
    if (preview.closed)
      throw new Error("The report preview was closed. Try exporting again.");
    preview.document.open();
    preview.document.write(html);
    preview.document.close();
    const printButton = preview.document.createElement("button");
    printButton.type = "button";
    printButton.textContent = "Print / save as PDF";
    printButton.className = "no-print";
    Object.assign(printButton.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      padding: "10px 20px",
      backgroundColor: "#f97316",
      color: "white",
      border: "none",
      borderRadius: "5px",
      cursor: "pointer",
      fontWeight: "bold",
      zIndex: "1000",
    });
    printButton.onclick = () => {
      printButton.style.display = "none";
      try {
        preview.print();
      } finally {
        printButton.style.display = "block";
      }
    };
    preview.document.body.appendChild(printButton);
  } catch (error) {
    preview.close();
    throw error;
  }
}
