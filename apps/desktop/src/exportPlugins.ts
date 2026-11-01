import { createBuiltinExporterRegistry } from '@odc/exporters';

/** Register reviewed, statically imported extensions here. Never import arbitrary remote code. */
export const exportPlugins = createBuiltinExporterRegistry();
