import { registerReportExport } from "./api";
import { buildReportCsv } from "./csv";
import { buildExportFileName, sha256Hex } from "./format";
import type {
  ExportContext,
  OperationalReport,
  ReportFilterLabels,
  ReportFilters,
  ReportType,
} from "./types";

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Dá tempo do navegador começar o download antes de liberar a URL
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/**
 * Registra a exportação (gera o código de verificação), monta o arquivo com
 * o código impresso e baixa com o nome padronizado.
 */
export const exportReport = async (params: {
  report: OperationalReport;
  type: ReportType;
  format: "pdf" | "csv";
  companyName: string;
  filters: ReportFilters;
  filterLabels: ReportFilterLabels;
}) => {
  const dataHash = await sha256Hex(JSON.stringify(params.report));

  const registered = await registerReportExport({
    filters: params.filters,
    type: params.type,
    format: params.format,
    dataHash,
    filterSummary: {
      startDay: params.filters.startDay,
      endDay: params.filters.endDay,
      channels: params.filterLabels.channels,
      department: params.filterLabels.department,
      attendant: params.filterLabels.attendant,
    },
  });

  const context: ExportContext = {
    type: params.type,
    companyName: params.companyName,
    filters: params.filters,
    filterLabels: params.filterLabels,
    generatedByName: registered.generatedByName ?? "Administrador",
    generatedAt: new Date(registered.createdAt ?? Date.now()),
    code: registered.code,
    dataHash,
  };

  const fileName = buildExportFileName({
    type: params.type,
    companyName: params.companyName,
    startDay: params.filters.startDay,
    endDay: params.filters.endDay,
    code: registered.code,
    extension: params.format,
  });

  if (params.format === "csv") {
    const csv = buildReportCsv(params.report, context);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), fileName);
  } else {
    const { renderReportPdf } = await import("./pdf/renderPdf");
    const blob = await renderReportPdf(params.report, context);
    downloadBlob(blob, fileName);
  }

  return { code: registered.code, fileName };
};
