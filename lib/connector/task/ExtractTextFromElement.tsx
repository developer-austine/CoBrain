import { TaskParamType, TaskType } from "@/types/task"
import { CodeIcon, LucideProps, TextIcon } from "lucide-react"

export const ExtractTexFromElementTask = {
    type: TaskType.EXTRACT_TEXT_FROM_ELEMENT,
    label: "Extract text from element",
    description: "Launch a web browser to a specified URL.",
    icon: (props: LucideProps) => (
        <TextIcon className="stroke-rose-400" {...props} />
    ),
    isEntryPoint: false,
    inputs: [
        {
            name: "Html",
            type: TaskParamType.STRING,
            required: true,
        },
        {
            name: "Selector",
            type: TaskParamType.STRING,
            required: true,
        },
    ],
    outputs: [
        {
            name: "Extracted Text",
            type: TaskParamType.STRING
        },
     ],
};