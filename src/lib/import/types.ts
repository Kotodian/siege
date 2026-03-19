export interface ImportableItem {
  id: string;
  title: string;
  description: string;
  source: string;
  sourceUrl?: string;
  children?: ImportableItem[];
}

export interface ImportResult {
  planName: string;
  planDescription: string;
  planTag: string;
  schemes: Array<{ title: string; content: string }>;
}

export interface ImportSource {
  name: string;
  validate(config: Record<string, string>): Promise<boolean>;
  listItems(
    config: Record<string, string>,
    query?: string
  ): Promise<ImportableItem[]>;
  fetchItem(
    config: Record<string, string>,
    itemId: string
  ): Promise<ImportResult>;
}
