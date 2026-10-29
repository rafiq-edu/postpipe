import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { notFound } from "next/navigation";
import { source } from "@/lib/docs/source";
import { APIPage } from "../api-page";

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const page = source.getPage((await props.params).slug);
  if (!page) notFound();
  if (page.data.type === "api")
    return (
      <DocsPage full>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsBody>
          <APIPage {...page.data.getOpenAPIPageProps()} />
        </DocsBody>
      </DocsPage>
    );

  const { body: Body, toc } = page.data;
  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Body components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}
