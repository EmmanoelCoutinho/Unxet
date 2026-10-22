import { pdf } from "@react-pdf/renderer";
import { ReportDocument } from "./ReportDocument";
import type { ExportContext, OperationalReport } from "../types";

// Carregado só ao exportar: a biblioteca de PDF é pesada para ficar no bundle da tela
export const renderReportPdf = (
  report: OperationalReport,
  context: ExportContext,
) => pdf(<ReportDocument report={report} context={context} />).toBlob();
