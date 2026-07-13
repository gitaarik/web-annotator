<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>Web Annotator</title>
	<meta name="description" content="Record and annotate browser sessions to produce training data for web-navigating AI agents." />
	<link rel="icon" href={favicon} />
</svelte:head>

<ThemeSwitcher />
{@render children()}
