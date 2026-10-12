import ShellLoading from '@/components/ShellLoading'

// One loading state for every page in the app shell. Without it, dynamic pages can't be
// prefetched and a sidebar click waits for the whole server render before anything changes.
export default function Loading() {
  return <ShellLoading />
}
