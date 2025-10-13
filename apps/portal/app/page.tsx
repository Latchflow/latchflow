import { BundlesList } from "@/components/bundles-list";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col px-4 py-12 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-start gap-12 pt-12">
        <BundlesList />
      </div>
    </div>
  );
}
