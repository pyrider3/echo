import { defineConfig } from "vite";
import { resolve } from "path";
export default defineConfig({root:resolve(__dirname,"chord-mobile"),base:"./",build:{outDir:resolve(__dirname,"chord-dist"),emptyOutDir:true}});
