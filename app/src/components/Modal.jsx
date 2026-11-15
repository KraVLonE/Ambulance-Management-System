import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Dialog shell: backdrop, Escape to close, bottom sheet on phones.
// Render children only while `open`, so each opening starts fresh.
const Modal = ({ open, onClose, labelledBy, locked = false, wide = false, children }) => {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape' && !locked) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, locked, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center sm:p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/50"
                        onClick={locked ? undefined : onClose}
                    />
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={labelledBy}
                        initial={{ y: 24, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 24, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className={`relative surface rounded-t-2xl sm:rounded-xl shadow-2xl p-5 sm:p-6 w-full ${wide ? 'sm:max-w-lg' : 'sm:max-w-md'} max-h-[92dvh] overflow-y-auto`}
                    >
                        {children}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default Modal;
