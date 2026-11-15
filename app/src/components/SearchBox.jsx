import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

// Address search over the map. Picking a result hands its coordinates to
// `onSelect`, exactly as if the user had clicked that spot.
const SearchBox = ({ onSelect }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null); // null = nothing searched yet
    const [searching, setSearching] = useState(false);
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const boxRef = useRef(null);

    // Search shortly after typing stops, cancelling any request still in flight.
    useEffect(() => {
        const text = query.trim();
        if (text.length < 3) return;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            setSearching(true);
            api.searchPlaces(text, controller.signal)
                .then(found => {
                    setResults(found);
                    setHighlight(0);
                    setOpen(true);
                })
                .catch(() => { if (!controller.signal.aborted) setResults([]); })
                .finally(() => { if (!controller.signal.aborted) setSearching(false); });
        }, 400);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    useEffect(() => {
        const onPointerDown = (e) => {
            if (!boxRef.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, []);

    const choose = (place) => {
        setOpen(false);
        setQuery('');
        setResults(null);
        onSelect(place);
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape') setOpen(false);
        if (!open || !results?.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % results.length); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + results.length) % results.length); }
        if (e.key === 'Enter') { e.preventDefault(); choose(results[highlight]); }
    };

    const showList = open && query.trim().length >= 3 && results !== null;

    return (
        <div ref={boxRef} className="relative">
            <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                placeholder="Search an address or place"
                aria-label="Search an address or place"
                role="combobox"
                aria-expanded={showList}
                aria-controls="place-results"
                className="input !rounded-full shadow-md !py-2 !pl-4"
            />
            {searching && <span className="absolute right-4 top-2.5 text-xs muted">Searching…</span>}
            {showList && (
                <ul id="place-results" role="listbox" className="absolute mt-1 w-full card shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                    {results.length === 0 ? (
                        <li className="px-3 py-2 text-sm muted">No places found. Try a nearby landmark or sector.</li>
                    ) : results.map((place, index) => (
                        <li key={`${place.lat},${place.lng},${index}`} role="option" aria-selected={index === highlight}>
                            <button
                                type="button"
                                onClick={() => choose(place)}
                                onMouseEnter={() => setHighlight(index)}
                                className={`w-full text-left px-3 py-2 text-sm ${index === highlight ? 'bg-gray-100 dark:bg-slate-800' : ''}`}
                            >
                                {place.label}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default SearchBox;
