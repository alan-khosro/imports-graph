// For JS/TS files in a given dir (or current dir), creates the DOT graph
// If git presents, respect git (git ls-files)
// deno --allow-run=git --alow-read imports-graph.ts

import { walk } from "jsr:@std/fs@1.0.4";
import * as path from "jsr:@std/path@1.0.6";

type FileName = string;
type Label = string;
type DirName = string;
type Heights = Record<FileName, number>;
type DirToFiles = Record<DirName, FileName[]>;
type Edge = { sourceNode: FileName; targetNode: FileName; label: Label };

async function findTsJsFiles(dir: DirName): Promise<FileName[]> {
	const gitTrackedFiles = await getGitTrackedFiles(dir);
	const files: string[] = [];
	for await (const entry of walk(dir, { exts: [".ts", ".js"] })) {
		if (entry.isFile && gitTrackedFiles.includes(entry.path)) {
			files.push(entry.path);
		}
	}
	return files;
}

async function getGitTrackedFiles(dir: DirName): Promise<FileName[]> {
	try {
		const process = Deno.run({
			cmd: ["git", "ls-files", "-co", "--exclude-standard"],
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

function extractImports(content: string): Array<[FileName, Label]> {
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

function normalizeImportPath(
	basePath: DirName,
	importPath: FileName
): FileName {
	if (importPath.startsWith(".")) {
		return path.normalize(path.join(path.dirname(basePath), importPath));
	}
	return importPath;
}

function escapeDoubleQuotes(str: FileName): FileName {
	return str.replace(/"/g, '\\"');
}

function getDirectoryPath(filePath: FileName): DirName {
	return path.dirname(filePath);
}

function createSubgraphName(dirPath: DirName): string {
	return `cluster_${dirPath.replace(/[^\w]/g, "_")}`;
}

/** for given directory (or current directory), creates import dependency graph in DOT notation and dumps to stdio */
export async function toDot(rootDir: DirName = ".") {
	const files = await findTsJsFiles(rootDir);
	const dirToFiles = groupFilesByDirectory(files);
	const edges = await createEdges(files);
	const heights = calculateHeights(edges, files);

	console.log("strict digraph TypeScriptImports {");
	console.log("  node [shape=box, fontsize=16];");
	console.log("  edge [fontsize=12];");
	console.log('  rankdir="LR"; nodesep="0.5"; ranksep="2"; labelloc="b";');

	outputSubgraphs(dirToFiles, heights);

	// output each edge
	edges.forEach(({ sourceNode, targetNode, label }) =>
		console.log(`  "${targetNode}" -> "${sourceNode}" ${label};`)
	);

	console.log("}");
}

function calculateHeights(edges: Edge[], files: FileName[]): Heights {
	const sourceCounts: Record<FileName, number> = {};
	const targetCounts: Record<FileName, number> = {};
	const heights: Heights = {};

	// make initial values zero
	files.forEach((file) => {
		sourceCounts[file] = 0;
		targetCounts[file] = 0;
	});

	for (const { sourceNode, targetNode } of edges) {
		sourceCounts[sourceNode]++;
		targetCounts[targetNode]++;
	}

	files.forEach((file) => {
		const height =
			Math.max(sourceCounts[file], targetCounts[file], 1) * 0.5;
		heights[file] = height;
	});
	return heights;
}

function outputSubgraphs(dirToFiles: DirToFiles, heights: Heights) {
	// Create subgraphs and edges
	for (const [dirPath, dirFiles] of Object.entries(dirToFiles)) {
		const subgraphName = createSubgraphName(dirPath);
		console.log(`  subgraph ${subgraphName} {`);
		console.log(`    label = "${escapeDoubleQuotes(dirPath)}";`);
		console.log(`    color = "blue"; fontcolor="blue"; fontsize=24;`);

		for (const file of dirFiles) {
			// strip file from directory and extension
			const fileName = file.split("/").pop()?.split(".").at(0) as string;

			// put files into dir subgraphs
			console.log(
				`    "${escapeDoubleQuotes(
					file
				)}"[label="${fileName}", height=${
					heights[file]
				}, href="${file}"];`
			);
		}

		console.log("  }");
	}
}

function groupFilesByDirectory(files: FileName[]): DirToFiles {
	const dirToFiles: DirToFiles = {};

	// Group files by directory
	for (const file of files) {
		const dirPath = getDirectoryPath(file);
		if (!dirToFiles[dirPath]) {
			dirToFiles[dirPath] = [];
		}

		dirToFiles[dirPath].push(file);
	}
	return dirToFiles;
}

async function createEdges(files: string[]): Promise<Edge[]> {
	const edges: Edge[] = [];
	// create edges for each file
	for (const file of files) {
		const content = await Deno.readTextFile(file);
		const imports = extractImports(content)
			// Normalize path
			.map(([importItem, importPath]) => {
				const normalizedImportPath = normalizeImportPath(
					file,
					importPath
				);
				return [importItem, normalizedImportPath];
			})
			// filter non internal modules (like node_modules)
			.filter(([_, importPath]) => files.includes(importPath));

		// create edges for this file
		imports.map(([importItems, importPath]) => {
			const edge = createEdge(file, importItems, importPath);
			edges.push(edge);
		});
	}
	return edges;
}

function createEdge(file: string, importItems: string, importPath: string) {
	const sourceNode = escapeDoubleQuotes(file);
	const targetNode = escapeDoubleQuotes(importPath);

	const label = importItems
		? `[label="${escapeDoubleQuotes(importItems)}"]`
		: "";

	const edge: Edge = { sourceNode, targetNode, label };
	return edge;
}

if (import.meta.main) {
	const rootDir = Deno.args[0] || ".";
	toDot(rootDir);
}
