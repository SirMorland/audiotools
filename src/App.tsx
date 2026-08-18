import { useCallback, useState } from "react";

import NightcoreTab from "./components/NightcoreTab";
import NormalizeTab from "./components/NormalizeTab";

type TabId = "nightcore" | "normalize";

const TAB_STORAGE_KEY = "audiotools-active-tab";

const tabs: { id: TabId; label: string }[] = [
	{ id: "normalize", label: "Normalize" },
	{ id: "nightcore", label: "Nightcorefy" },
];

function App() {
	const [activeTab, setActiveTab] = useState<TabId>(
		// Restore from localStorage if available, otherwise default to nightcore
		(() => {
			try {
				const saved = localStorage.getItem(TAB_STORAGE_KEY);
				if (saved === "nightcore" || saved === "normalize") return saved;
			} catch {
				// localStorage unavailable
			}
			return "normalize";
		})(),
	);

	const setTab = useCallback((tab: TabId) => {
		setActiveTab(tab);
		try {
			localStorage.setItem(TAB_STORAGE_KEY, tab);
		} catch {
			// localStorage unavailable
		}
	}, []);

	const content: Record<TabId, React.ReactNode> = {
		nightcore: <NightcoreTab />,
		normalize: <NormalizeTab />,
	};

	return (
		<main>
			<h1>Audio Tools</h1>
			<nav>
				{tabs.map((tab) => (
					<button
						key={tab.id}
						aria-selected={activeTab === tab.id}
						className={activeTab === tab.id ? "active" : undefined}
						onClick={() => setTab(tab.id)}
					>
						{tab.label}
					</button>
				))}
			</nav>
			{content[activeTab]}
		</main>
	);
}

export default App;
