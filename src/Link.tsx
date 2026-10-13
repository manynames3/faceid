import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate } from "./router";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/**
 * A real anchor (so it can be opened in a new tab, copied or middle-clicked)
 * that swaps pages in place for a plain left click.
 */
export function Link({ href, onClick, target, ...rest }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== "_self") ||
      !href.startsWith("/") ||
      href.startsWith("//")
    ) {
      return;
    }
    event.preventDefault();
    navigate(href);
  }

  return <a {...rest} href={href} onClick={handleClick} target={target} />;
}
