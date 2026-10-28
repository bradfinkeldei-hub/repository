/** A member's photo, or their initials when they haven't added one. */
export function Avatar({ name, url, size = 38 }: { name: string; url?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (url) return <img className="avatar" src={url} alt="" width={size} height={size} style={{ ...style, objectFit: "cover" }} />;
  return <div className="avatar" style={style} aria-hidden="true">{initials(name)}</div>;
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}
