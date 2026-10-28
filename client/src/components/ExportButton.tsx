import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { openReportPreview } from "@/lib/report-preview";
import { userFacingApiError } from "@/lib/errors";

interface ExportButtonProps {
  onExportHtml: () => Promise<{ html: string; filename: string }>;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

export function ExportButton({
  onExportHtml,
  label = "Export",
  variant = "outline",
  size = "sm",
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: "html" | "pdf") => {
    setIsExporting(true);
    try {
      if (format === "html") {
        const { html, filename } = await onExportHtml();
        // Download as HTML
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("HTML report downloaded");
      } else {
        await openReportPreview(onExportHtml);
        toast.success("Report preview opened");
      }
    } catch (error) {
      toast.error(userFacingApiError(error, "Failed to generate report. Try again shortly."));
      console.error(error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport("pdf")}>
          <FileText className="h-4 w-4 mr-2" />
          Export as PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("html")}>
          <FileText className="h-4 w-4 mr-2" />
          Export as HTML
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Simple export button for direct download
export function SimpleExportButton({
  onClick,
  label = "Export",
  isLoading = false,
  variant = "outline",
  size = "sm",
}: {
  onClick: () => void;
  label?: string;
  isLoading?: boolean;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  return (
    <Button variant={variant} size={size} onClick={onClick} disabled={isLoading}>
      {isLoading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-2" />
      )}
      {label}
    </Button>
  );
}
