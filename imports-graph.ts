// For JS/TS files in a given dir (or current dir), creates the DOT graph
// If git presents, respect git (git ls-files)
// deno --allow-run=git --alow-read imports-graph.ts

import { walk } from "jsr:@std/fs@1.0.4";
import * as path from "jsr:@std/path@1.0.6";

async function findTsJsFiles(dir: string): Promise<string[]> {
	const gitTrackedFiles = await getGitTrackedFiles(dir);
	const files: string[] = [];
	for await (const entry of walk(dir, { exts: [".ts", ".js"] })) {
		if (entry.isFile && gitTrackedFiles.includes(entry.path)) {
			files.push(entry.path);
		}
	}
	return files;
}

async function getGitTrackedFiles(dir: string): Promise<string[]> {
	try {
		const process = Deno.run({
			cmd: ["git", "ls-files"],
			cwd: dir,
			stdout: "piped",
		});
		const output = await process.output();
		const files = new TextDecoder().decode(output).trim().split("\n");
		process.close();
		return files.map((file) => path.join(dir, file));
	} catch (error) {
		console.error("Error running git command:", error);
		const files: string[] = [];
		for await (const file of walk(dir)) {
			files.push(file.path);
		}
		return files;
	}
}

function extractImports(content: string): Array<[string, string]> {
	const importRegex =
		/import\s+(?:type\s+)?(?:(\w+)(?:\s+as\s+(\w+))?|{([\s\S]*?)}|\*\s+as\s+(\w+))?\s*(?:from\s*)?["']([^"']+)["']/g;
	const imports: Array<[string, string]> = [];
	let match;
	while ((match = importRegex.exec(content)) !== null) {
		const [
			,
			defaultImport,
			aliasedImport,
			namedImports,
			namespaceImport,
			importPath,
		] = match;
		let importItems = "";
		if (defaultImport) {
			importItems = aliasedImport
				? `${defaultImport} as ${aliasedImport}`
				: defaultImport;
		} else if (namedImports) {
			importItems = namedImports
				.split(",")
				.map((item) => item.trim())
				.join("\\n");
		} else if (namespaceImport) {
			importItems = `* as ${namespaceImport}`;
		}
		imports.push([importItems, importPath]);
	}
	return imports;
}

function normalizeImportPath(basePath: string, importPath: string): string {
	if (importPath.startsWith(".")) {
		return path.normalize(path.join(path.dirname(basePath), importPath));
	}
	return importPath;
}

function escapeDoubleQuotes(str: string): string {
	return str.replace(/"/g, '\\"');
}

function getDirectoryPath(filePath: string): string {
	return path.dirname(filePath);
}

function createSubgraphName(dirPath: string): string {
	return `cluster_${dirPath.replace(/[^\w]/g, "_")}`;
}

/** for given directory (or current directory), creates import dependency graph in DOT notation and dumps to stdio */
export async function toDot(rootDir: string = ".") {
	const files = await findTsJsFiles(rootDir);

	console.log("strict digraph TypeScriptImports {");
	console.log("  node [shape=box];");
	console.log("  edge [fontsize=8];");
	console.log('  rankdir="LR";');

	const dirToFiles: { [key: string]: string[] } = {};
	const edges: string[] = [];

	// Group files by directory
	for (const file of files) {
		const dirPath = getDirectoryPath(file);
		if (!dirToFiles[dirPath]) {
			dirToFiles[dirPath] = [];
		}

		dirToFiles[dirPath].push(file);
	}

	// Create subgraphs and edges
	for (const [dirPath, dirFiles] of Object.entries(dirToFiles)) {
		const subgraphName = createSubgraphName(dirPath);
		console.log(`  subgraph ${subgraphName} {`);
		console.log(`    label = "${escapeDoubleQuotes(dirPath)}";`);
		console.log(`    color = "blue"; fontcolor="blue";`);

		for (const file of dirFiles) {
			const content = await Deno.readTextFile(file);
			const imports = extractImports(content);

			// strip file from directory and extension
			const fileName = file.split("/").pop()?.split(".").at(0) as string;

			console.log(
				`    "${escapeDoubleQuotes(file)}"[label="${fileName}"];`
			);

			for (const [importItems, importPath] of imports) {
				const normalizedImportPath = normalizeImportPath(
					file,
					importPath
				);
				const sourceNode = escapeDoubleQuotes(file);
				const targetNode = escapeDoubleQuotes(normalizedImportPath);

				// exclude non git tracked files
				if (!files.includes(targetNode)) {
					continue;
				}

				const label = importItems
					? `[label="${escapeDoubleQuotes(importItems)}"]`
					: "";

				edges.push(`  "${sourceNode}" -> "${targetNode}" ${label};`);
			}
		}

		console.log("  }");
	}

	// Output all edges after subgraphs
	edges.forEach((edge) => console.log(edge));

	console.log("}");
}

if (import.meta.main) {
	const rootDir = Deno.args[0] || ".";
	toDot(rootDir);
}
