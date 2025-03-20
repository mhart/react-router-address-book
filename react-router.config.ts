import { type Config } from "@react-router/dev/config";

export default {
  ssr: true,
  prerender: ["/about"],
  future: {
    unstable_viteEnvironmentApi: true,
  },
} satisfies Config;
