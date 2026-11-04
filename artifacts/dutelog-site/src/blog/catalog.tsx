import { createContext, useContext, type ReactNode } from "react";
import { articles as legacyArticles, type Article } from "../content";

const ArticleCatalog = createContext<Article[]>(legacyArticles);

export function ArticlesProvider({
  articles,
  children,
}: {
  articles: Article[];
  children: ReactNode;
}) {
  return (
    <ArticleCatalog.Provider value={articles}>
      {children}
    </ArticleCatalog.Provider>
  );
}

export function useArticles(): Article[] {
  return useContext(ArticleCatalog);
}
