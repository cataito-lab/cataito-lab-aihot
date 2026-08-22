import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // CF Pages build runner has ESM import resolution issues with
    // eslint-config-next subpaths; run lint locally instead.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;