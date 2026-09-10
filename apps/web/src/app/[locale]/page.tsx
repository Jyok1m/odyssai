import { Hero } from "@/components/marketing/hero";
import { SiteHeader } from "@/components/marketing/site-header";

export default function HomePage() {
	return (
		<>
			<SiteHeader />
			<main>
				<Hero />
			</main>
		</>
	);
}
