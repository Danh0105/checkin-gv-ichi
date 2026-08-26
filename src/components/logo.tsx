import { ImgHTMLAttributes } from "react";

import logoSrc from "@/static/log-cty.png";

function Logo({ className, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return <img src={logoSrc} alt="ICHI SKILL" className={["brand-logo", className].filter(Boolean).join(" ")} {...props} />;
}

export default Logo;
