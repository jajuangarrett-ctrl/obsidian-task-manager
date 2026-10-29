import type { TaskRecord } from "./types";
export function isConvertedOriginal(record: Pick<TaskRecord,"converted_to"|"__fjgConversionLinks">): boolean {
  return Boolean(record.converted_to || record.__fjgConversionLinks?.length);
}
