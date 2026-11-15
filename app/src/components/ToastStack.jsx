import { motion, AnimatePresence } from 'framer-motion';

const TONE = {
    success: 'border-green-500',
    info: 'border-secondary',
    warning: 'border-amber-500',
    error: 'border-primary',
};

const ToastStack = ({ toasts, onDismiss }) => (
    <div
        className="fixed bottom-4 left-4 right-4 sm:right-auto z-[2500] flex flex-col gap-2 sm:max-w-sm pointer-events-none"
        role="status"
        aria-live="polite"
    >
        <AnimatePresence initial={false}>
            {toasts.map(toast => (
                <motion.div
                    key={toast.id}
                    layout
                    initial={{ opacity: 0, y: 16, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.2 }}
                    className={`pointer-events-auto surface heading shadow-lg rounded-lg border-l-4 pl-3 pr-2 py-2.5 text-sm font-medium flex items-start gap-2 ${TONE[toast.tone] || TONE.info}`}
                >
                    <span className="flex-1">{toast.message}</span>
                    <button
                        type="button"
                        onClick={() => onDismiss(toast.id)}
                        className="muted hover:text-gray-700 dark:hover:text-slate-100 px-1 leading-none text-base"
                        aria-label="Dismiss notification"
                    >
                        ×
                    </button>
                </motion.div>
            ))}
        </AnimatePresence>
    </div>
);

export default ToastStack;
