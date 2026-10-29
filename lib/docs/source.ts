import { loader, multiple } from "fumadocs-core/source";
import { docs } from "@/.source/server";
import { openapi } from "./openapi";

export const source = loader(
  multiple({
    docs: docs.toFumadocsSource(),
    api: await openapi.staticSource({ baseDir: "api" }),
  }),
  { baseUrl: "/docs", plugins: [openapi.loaderPlugin()] },
);
