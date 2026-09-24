export type SegmentedControlRole = "group" | "radiogroup" | "tablist";

type SegmentedControlOptionIdentity = Readonly<{
  value: string;
  id?: string;
  controls?: string;
}>;

export type SegmentedControlItemAttributes =
  | Readonly<{
      role: "tab";
      id: string;
      "aria-selected": boolean;
      "aria-controls"?: string;
    }>
  | Readonly<{ role: "radio"; "aria-checked": boolean }>
  | Readonly<{ "aria-pressed": boolean }>;

export function getSegmentedControlItemAttributes(
  role: SegmentedControlRole,
  label: string,
  selectedValue: string,
  option: SegmentedControlOptionIdentity,
): SegmentedControlItemAttributes {
  const selected = selectedValue === option.value;

  if (role === "tablist") {
    return {
      role: "tab",
      id: option.id ?? `${label}-tab-${option.value}`,
      "aria-selected": selected,
      ...(option.controls ? { "aria-controls": option.controls } : {}),
    };
  }

  if (role === "radiogroup") {
    return { role: "radio", "aria-checked": selected };
  }

  return { "aria-pressed": selected };
}
