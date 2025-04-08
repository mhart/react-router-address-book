# Deploying an existing React Router app to Cloudflare Workers

This project highlights how to get an existing (Node.js or otherwise) React Router project deployed on
[Cloudflare Workers](https://developers.cloudflare.com/workers/frameworks/framework-guides/react-router/).

(If instead you want to start a project from scratch, the easiest way is by following [the framework guide on the Cloudflare Docs site](https://developers.cloudflare.com/workers/frameworks/framework-guides/react-router/))

This example uses the completed [Address Book tutorial](https://reactrouter.com/tutorials/address-book)
as the project we want to deploy to Cloudflare. You can view the code at that point [here](https://github.com/mhart/react-router-address-book/tree/b24196466a1f8e73c330f00d38832bce5a5cae0d).

If you want the TLDR, you can see [this commit](https://github.com/mhart/react-router-address-book/commit/0fdaeb6ddb86211e2d932e4a6c1b0bbab76ec077) for the additions outlined here to deploy it on Cloudflare.

## Install steps

Firstly we'll install the [`wrangler` CLI tool](https://developers.cloudflare.com/workers/wrangler/) to manage Workers and other Cloudflare products, as well as the [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/).

```sh
npm install -D wrangler @cloudflare/vite-plugin
```

We can also remove some packages we'll no longer need (this step is optional)

```sh
npm rm @react-router/node @react-router/serve cross-env
```

## Modify config

### `react-router.config.ts`

Enable support for the [Vite Environment API](https://vite.dev/guide/api-environment) in `react-router.config.ts`:

```diff
  export default {
    ssr: true,
    prerender: ["/about"],
+   future: {
+     unstable_viteEnvironmentApi: true,
+   },
  } satisfies Config;
```

### `vite.config.ts`

And add the [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/) to `vite.config.ts`:

```diff
  import { reactRouter } from "@react-router/dev/vite";
+ import { cloudflare } from "@cloudflare/vite-plugin";
  import { defineConfig } from "vite";

  export default defineConfig({
-   plugins: [reactRouter()],
+   plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), reactRouter()],
```

Note that because the Address Book tutorial uses Server-Side Rendering (`ssr: true`), we've specified to use the `ssr` Vite environment here.

## Add Workers-specific config

### `wrangler.jsonc`

Any [Workers-specific configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), such as the name of our Worker, [bindings to other products](https://developers.cloudflare.com/workers/runtime-apis/bindings/) or observability features, are specified in `wrangler.jsonc`:

```json
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "react-router-address-book",
  "compatibility_date": "2025-04-04",
  "main": "./workers/app.ts",
  "observability": {
    "enabled": true
  }
}
```

## Add Worker entrypoint files

### `workers/app.ts`

The entrypoint for the Worker script is our request handler, referred to from the `main` field in our `wrangler.jsonc` above.

```sh
mkdir workers
```

And then create `workers/app.ts` with this:

```ts
import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
```

You can find the latest version of this file in the [official React Router Cloudflare template](https://github.com/remix-run/react-router-templates/blob/main/cloudflare/workers/app.ts).

### `app/entry.server.tsx`

Similarly we'll need an [`entry.server.tsx`](https://reactrouter.com/explanation/special-files#entryservertsx) tailored to a non-Node.js runtime. Create this file in `app/entry.server.tsx`:

```ts
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell.  Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    }
  );
  shellRendered = true;

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
```

You can also find the latest version of this file in the [official React Router Cloudflare template](https://github.com/remix-run/react-router-templates/blob/main/cloudflare/app/entry.server.tsx).

## Extra bits

Ensure the `.wrangler` directory won't be committed, via your `.gitconfig`:

```diff
  # React Router
  /.react-router/
  /build/
+ /.wrangler
```

Add some new commands for previewing and deploying in `package.json`:

```diff
   "scripts": {
-    "build": "cross-env NODE_ENV=production react-router build",
+    "build": "react-router build",
     "dev": "react-router dev",
-    "start": "cross-env NODE_ENV=production react-router-serve ./build/server/index.js",
-    "typecheck": "react-router typegen && tsc"
+    "preview": "npm run build && vite preview",
+    "deploy": "npm run build && wrangler deploy",
+    "typegen": "wrangler types && react-router typegen",
+    "typecheck": "npm run typegen && tsc"
   },
```

Generate types:

```sh
npm run typegen
```

(this will create a `worker-configuration.d.ts` file with type information)

And you're all done!

## Dev, Preview and Deploy

Development mode is the quickest way to develop locally:

```sh
npm run dev
```

Preview mode will do a full production build and run `vite preview`:

```sh
npm run preview
```

And then to deploy your project to Workers:

```sh
npm run deploy
```

Hooray, it's now live!

## Accessing Cloudflare products

You can access bindings to other products like [Workers AI](https://developers.cloudflare.com/workers-ai/), [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/), etc via the `context.cloudflare.env` property on loader/action functions.

For example, let's say we add an [environment variable](https://developers.cloudflare.com/workers/configuration/environment-variables/) binding to our `wrangler.jsonc`:

```diff
   "main": "./workers/app.ts",
+  "vars": {
+    "ABOUT_LINK_TITLE": "React Router Contacts"
+  },
   "observability": {
```

We can then access that, say, from the loader in `app/layouts/sidebar.tsx`:

```diff
  import { getContacts } from "../data";
  import type { Route } from "./+types/sidebar";

- export async function loader({ request }: Route.LoaderArgs) {
+ export async function loader({ request, context }: Route.LoaderArgs) {
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const contacts = await getContacts(q);
-   return { contacts, q };
+   const linkTitle = context.cloudflare.env.ABOUT_LINK_TITLE;
+   return { contacts, q, linkTitle };
  }

  export default function SidebarLayout({ loaderData }: Route.ComponentProps) {
-   const { contacts, q } = loaderData;
+   const { contacts, q, linkTitle } = loaderData;
    const navigation = useNavigation();
    const submit = useSubmit();
    const searching =

// ...

        <div id="sidebar">
          <h1>
-           <Link to="about">React Router Contacts</Link>
+           <Link to="about">{linkTitle}</Link>
          </h1>
          <div>
            <Form
```

You can see that modifying that variable in `wrangler.jsonc` will change the link title – live in dev mode too.

Similarly if you added a binding to [Workers AI](https://developers.cloudflare.com/workers-ai/), you could access that from `context.cloudflare.env.AI`, etc.
