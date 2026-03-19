import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ChartGenerator {
	private width = 1000;
	private height = 650;
	private palette = [
		"#3B82F6",
		"#10B981",
		"#F59E0B",
		"#EF4444",
		"#8B5CF6",
		"#14B8A6",
		"#A855F7",
		"#F97316",
		"#22C55E",
		"#06B6D4",
	];
	private canvas = new ChartJSNodeCanvas({
		width: this.width,
		height: this.height,
		backgroundColour: "white",
	});

	private ensureOutputDir() {
		const outputDir = path.resolve(__dirname, "../../charts");
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}
		return outputDir;
	}

	async generatePieChart(
		labels: string[],
		data: number[],
		title: string,
		fileName: string,
	) {
		const colors = labels.map((_, index) => this.palette[index % this.palette.length]);
		const config: any = {
			type: "pie",
			data: {
				labels,
				datasets: [
					{
						label: title,
						data,
						backgroundColor: colors,
					},
				],
			},
			options: {
				plugins: {
					title: {
						display: true,
						text: title,
					},
					legend: {
						position: "right",
					},
				},
			},
		};

		const image = await this.canvas.renderToBuffer(config);
		const outputDir = this.ensureOutputDir();
		fs.writeFileSync(path.join(outputDir, fileName), image);
	}

	async generateBarChart(
		labels: string[],
		data: number[],
		title: string,
		fileName: string,
	) {
		const config: any = {
			type: "bar",
			data: {
				labels,
				datasets: [
					{
						label: title,
						data,
						backgroundColor: "#3B82F6",
					},
				],
			},
			options: {
				indexAxis: "y",
				plugins: {
					title: {
						display: true,
						text: title,
					},
					legend: {
						display: false,
					},
				},
				scales: {
					x: {
						beginAtZero: true,
					},
				},
			},
		};

		const image = await this.canvas.renderToBuffer(config);
		const outputDir = this.ensureOutputDir();
		fs.writeFileSync(path.join(outputDir, fileName), image);
	}

	async generateStackedBarChart(
		labels: string[],
		datasets: Array<{ label: string; data: number[] }>,
		title: string,
		fileName: string,
	) {
		const mappedDatasets = datasets.map((dataset, index) => ({
			...dataset,
			backgroundColor: this.palette[index % this.palette.length],
		}));

		const config: any = {
			type: "bar",
			data: {
				labels,
				datasets: mappedDatasets,
			},
			options: {
				plugins: {
					title: {
						display: true,
						text: title,
					},
					legend: {
						position: "right",
					},
				},
				scales: {
					x: {
						stacked: true,
					},
					y: {
						stacked: true,
						beginAtZero: true,
					},
				},
			},
		};

		const image = await this.canvas.renderToBuffer(config);
		const outputDir = this.ensureOutputDir();
		fs.writeFileSync(path.join(outputDir, fileName), image);
	}

	async generateGroupedBarChart(
		labels: string[],
		datasets: Array<{ label: string; data: number[] }>,
		title: string,
		fileName: string,
	) {
		const mappedDatasets = datasets.map((dataset, index) => ({
			...dataset,
			backgroundColor: this.palette[index % this.palette.length],
		}));

		const config: any = {
			type: "bar",
			data: {
				labels,
				datasets: mappedDatasets,
			},
			options: {
				plugins: {
					title: {
						display: true,
						text: title,
					},
					legend: {
						position: "right",
					},
				},
				scales: {
					x: {
						stacked: false,
					},
					y: {
						beginAtZero: true,
					},
				},
			},
		};

		const image = await this.canvas.renderToBuffer(config);
		const outputDir = this.ensureOutputDir();
		fs.writeFileSync(path.join(outputDir, fileName), image);
	}
}