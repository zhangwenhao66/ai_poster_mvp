export type TemplateItem = {
  id: string;
  file: string;
  path: string;
};

export type TemplateCategory = {
  id: string;
  name: string;
  templates: TemplateItem[];
};

export type TemplateIndex = {
  categories: TemplateCategory[];
};
