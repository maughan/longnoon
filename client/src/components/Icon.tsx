import { ICON_PATHS, type IconName } from "./iconsgen";

export type { IconName };
export { ICON_GROUPS } from "./iconsgen";

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  /** Pixel size for both width and height. Default 24. */
  size?: number;
  /** Accessible label. Omit for decorative icons (the default). */
  label?: string;
}

/**
 * Every icon inherits `currentColor`, so colour comes from the parent's
 * `color` property - not a prop. That means an icon inside a disabled button
 * or a Fevered card dims automatically with its container.
 *
 *   <span style={{ color: 'var(--ln-dread)' }}><Icon name="whisper" /></span>
 */
export function Icon({ name, size = 24, label, ...rest }: IconProps) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: d }}
      {...rest}
    />
  );
}

/**
 * Repeat an icon n times - Whisper pips on a Sign, Scars on a board, Menace
 * value on a Threat. Board games count things; this is the common case.
 */
export function IconCount({
  name,
  count,
  size = 16,
  label,
}: {
  name: IconName;
  count: number;
  size?: number;
  label?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label ?? `${count} ${name}`}
      style={{ display: "inline-flex", gap: 2, alignItems: "center" }}
    >
      {Array.from({ length: count }, (_, i) => (
        <Icon key={i} name={name} size={size} />
      ))}
    </span>
  );
}
